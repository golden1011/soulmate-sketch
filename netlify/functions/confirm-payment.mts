// POST /api/confirm-payment { sessionId, leadId?, pkg? }
// Called by the thank-you page after Stripe sends the buyer back. Asks Stripe whether the
// Checkout Session is really paid, then marks the lead as paid. Returns `firstTime: true`
// only the first time a given payment is recorded, so the page fires the Meta Purchase
// event once per real order (not on refreshes or a hand-typed ?paid= link).
import type { Config } from "@netlify/functions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { leads, type Lead } from "../../db/schema.js";
import { clean, isUuid, json, normLang, normPkg } from "../../db/util.js";

const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;
// Fallback when the session has no package metadata. EUR: €17 basic / €37 complete (older USD orders: $37 / $67).
const pkgFromAmount = (cents: number | null, currency: string | null) => {
  if (currency === "eur") return cents === 1700 ? "basic" : cents === 3700 ? "complete" : null;
  return cents === 3700 ? "basic" : cents === 6700 ? "complete" : null;
};

export default async (req: Request) => {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json({ error: "Stripe is not configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!SESSION_RE.test(sessionId)) return json({ error: "Invalid session id" }, 400);

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${secret}`, "Stripe-Version": "2024-06-20" },
  });
  if (!res.ok) return json({ paid: false }, res.status === 404 ? 404 : 502);
  const s = await res.json();

  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  const meta: Record<string, string> = s.metadata || {};
  const amountCents: number | null = typeof s.amount_total === "number" ? s.amount_total : null;
  const pkg = normPkg(meta.package) || pkgFromAmount(amountCents, s.currency ? String(s.currency).toLowerCase() : null) || normPkg(body.pkg);
  const email = clean(s.customer_details?.email);
  const result = {
    paid,
    pkg,
    value: amountCents != null ? amountCents / 100 : null,
    currency: s.currency ? String(s.currency).toUpperCase() : null,
    email,
  };
  if (!paid) return json({ ...result, firstTime: false });

  // Already recorded? (refresh, back button, second tab)
  const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.stripeSessionId, sessionId));
  if (existing) return json({ ...result, firstTime: false });

  const now = new Date();
  const payment = {
    amountCents,
    currency: s.currency || null,
    customerEmail: email,
    stripeSessionId: sessionId,
    paidAt: now,
    updatedAt: now,
    ...(pkg ? { package: pkg } : {}),
  };

  // Embedded checkout puts the lead id in client_reference_id + metadata; Payment Links get it via ?client_reference_id=.
  const leadId = [s.client_reference_id, meta.lead_id, body.leadId].find(isUuid);
  let lead: Lead | undefined;
  if (leadId) [lead] = await db.select().from(leads).where(eq(leads.id, leadId));

  if (lead && !lead.stripeSessionId) {
    const updated = await db
      .update(leads)
      .set({ ...payment, paidAt: sql`coalesce(${leads.paidAt}, ${now.toISOString()}::timestamptz)`,
        status: sql`case when ${leads.status} = 'delivered' then 'delivered' else 'paid' end` })
      .where(and(eq(leads.id, lead.id), isNull(leads.stripeSessionId)))
      .returning({ manualPurchase: leads.manualPurchase })
      .catch(() => []); // unique clash = a parallel request already recorded it
    return json({ ...result, firstTime: updated.length > 0 && !updated[0].manualPurchase });
  }

  // No matching lead (quiz data lost, or this lead already paid once before): record the order as its own row.
  const inserted = await db
    .insert(leads)
    .values({
      id: crypto.randomUUID(),
      status: "paid",
      name: clean(meta.name, 120) || lead?.name || clean(s.customer_details?.name, 120),
      whatsapp: clean(meta.whatsapp, 40) || lead?.whatsapp || clean(s.customer_details?.phone, 40),
      interest: clean(meta.interest, 60) || lead?.interest || null,
      dob: clean(meta.dob, 60) || lead?.dob || null,
      ethnicity: clean(meta.ethnicity, 120) || lead?.ethnicity || null,
      consent: lead?.consent ?? false,
      language: normLang(meta.language || lead?.language),
      utmSource: lead?.utmSource ?? null,
      utmMedium: lead?.utmMedium ?? null,
      utmCampaign: lead?.utmCampaign ?? null,
      utmContent: lead?.utmContent ?? null,
      utmTerm: lead?.utmTerm ?? null,
      referrer: lead?.referrer ?? null,
      fbclid: lead?.fbclid ?? null,
      fbc: lead?.fbc ?? null,
      landingUrl: lead?.landingUrl ?? null,
      notes: lead ? `Repeat order (original lead ${lead.id})` : "",
      ...payment,
    })
    .onConflictDoNothing({ target: leads.stripeSessionId })
    .returning({ id: leads.id });
  return json({ ...result, firstTime: inserted.length > 0 });
};

export const config: Config = {
  path: "/api/confirm-payment",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
