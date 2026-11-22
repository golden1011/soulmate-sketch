// Admin API for the mini CRM at /admin. Every request needs the ADMIN_PASSWORD
// (Netlify environment variable) as a Bearer token.
//   GET    /api/admin/leads                       — list all leads, newest first
//   PATCH  /api/admin/leads { id, status?, notes? } — update status / notes
//   DELETE /api/admin/leads { id }                 — remove a test or junk lead
import type { Config } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { leads, type Lead, type ManualPurchase } from "../../db/schema.js";
import { STATUSES, isUuid, json, metaAttribution, normPkg, type Status } from "../../db/util.js";
import { sendManualPurchase } from "../lib/manual-purchase.mjs";

const digest = (v: string) => createHash("sha256").update(v).digest();
const RETRY_WINDOW_SECONDS = 24 * 60 * 60;

async function reportPurchase(row: Lead, purchase: ManualPurchase) {
  const sent = await sendManualPurchase(row.id, purchase);
  const manualPurchase: ManualPurchase = { ...purchase, state: sent ? "sent" : "failed" };
  const [updated] = await db.update(leads).set({ manualPurchase })
    .where(and(eq(leads.id, row.id), eq(leads.manualPurchase, purchase))).returning();
  return json({ lead: updated ?? row });
}

function authorized(req: Request): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return given.length > 0 && timingSafeEqual(digest(given), digest(password));
}

export default async (req: Request) => {
  if (!process.env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not set in Netlify" }, 503);
  if (!authorized(req)) return json({ error: "Wrong password" }, 401);

  if (req.method === "GET") {
    const rows = await db.select().from(leads).orderBy(desc(leads.createdAt)).limit(10000);
    return json({ leads: rows });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!isUuid(body.id)) return json({ error: "Invalid lead id" }, 400);
  const id = body.id;

  if (req.method === "DELETE") {
    await db.delete(leads).where(eq(leads.id, id));
    return json({ ok: true });
  }

  if (body.status === "paid" || body.retryPurchase === true) {
    const [current] = await db.select().from(leads).where(eq(leads.id, id));
    if (!current) return json({ error: "Lead not found" }, 404);
    const now = new Date();
    const seconds = Math.floor(now.getTime() / 1000);

    if (body.retryPurchase === true) {
      const previous = current.manualPurchase;
      if (!previous || previous.state === "sent" || !["paid", "delivered"].includes(current.status)) {
        return json({ error: "There is no pending Meta purchase for this lead." }, 409);
      }
      if (seconds - previous.eventTime >= RETRY_WINDOW_SECONDS) {
        return json({ error: "The Meta retry window for this purchase has closed." }, 409);
      }
      if (previous.state === "sending" && seconds - previous.attemptedAt < 30) {
        return json({ error: "A Meta purchase is already being sent. Refresh shortly." }, 409);
      }
      const purchase: ManualPurchase = { ...previous, attemptedAt: seconds, state: "sending" };
      const [claimed] = await db.update(leads).set({ manualPurchase: purchase })
        .where(and(eq(leads.id, id), eq(leads.manualPurchase, previous), inArray(leads.status, ["paid", "delivered"])))
        .returning();
      if (!claimed) return json({ error: "The lead changed. Refresh before retrying." }, 409);
      return reportPurchase(claimed, purchase);
    }

    if (!current.paidAt && !current.stripeSessionId && ["new", "checkout"].includes(current.status)) {
      const selectedPackage = normPkg(body.package);
      if (body.package !== undefined && !selectedPackage) return json({ error: "Invalid package" }, 400);
      const pkg = selectedPackage ?? normPkg(current.package);
      const useRecordedAmount = current.amountCents != null && current.amountCents >= 0 &&
        current.currency && /^[a-z]{3}$/i.test(current.currency) && (!selectedPackage || selectedPackage === current.package);
      const amountCents = useRecordedAmount ? current.amountCents! : pkg === "basic" ? 1700 : pkg === "complete" ? 3700 : null;
      const currency = useRecordedAmount ? current.currency!.toUpperCase() : "EUR";
      if (amountCents == null) return json({ error: "Select the package that was paid for." }, 422);

      const attribution = metaAttribution(current.fbclid, current.fbc);
      const fbc = attribution.fbc ?? (attribution.fbclid ? `fb.1.${current.createdAt.getTime()}.${attribution.fbclid}` : null);
      const purchase: ManualPurchase | null = fbc ? {
        fbc, amountCents, currency, eventTime: seconds, attemptedAt: seconds, state: "sending",
      } : null;
      const [row] = await db.update(leads).set({
        status: "paid", paidAt: now, deliveredAt: null, updatedAt: now,
        package: pkg, amountCents, currency, manualPurchase: purchase,
        ...(typeof body.notes === "string" ? { notes: body.notes.slice(0, 5000) } : {}),
      }).where(and(eq(leads.id, id), eq(leads.status, current.status), isNull(leads.paidAt), isNull(leads.stripeSessionId))).returning();
      if (!row) return json({ error: "The lead changed. Refresh before marking it paid." }, 409);
      return purchase ? reportPurchase(row, purchase) : json({ lead: row });
    }
  }

  // PATCH
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.notes === "string") set.notes = body.notes.slice(0, 5000);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) return json({ error: "Invalid status" }, 400);
    const status = body.status as Status;
    set.status = status;
    set.deliveredAt = status === "delivered" ? sql`coalesce(${leads.deliveredAt}, now())` : null;
    if (status === "paid" || status === "delivered") set.paidAt = sql`coalesce(${leads.paidAt}, now())`;
    if (status === "checkout") set.checkoutAt = sql`coalesce(${leads.checkoutAt}, now())`;
  }
  const [row] = await db.update(leads).set(set).where(eq(leads.id, id)).returning();
  if (!row) return json({ error: "Lead not found" }, 404);
  return json({ lead: row });
};

export const config: Config = {
  path: "/api/admin/leads",
  method: ["GET", "PATCH", "DELETE"],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
