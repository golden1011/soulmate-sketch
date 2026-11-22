// Public endpoint used by the funnel pages (no login):
//   POST /api/leads           — save (or update) a lead when the quiz is finished
//   POST /api/leads/checkout  — mark that the lead reached checkout
// Lead IDs are random UUIDs generated in the browser, so one visitor cannot guess another's lead.
import type { Config } from "@netlify/functions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { leads } from "../../db/schema.js";
import { clean, isUuid, json, metaAttribution, normLang, normPkg } from "../../db/util.js";

export default async (req: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!isUuid(body.id)) return json({ error: "Invalid lead id" }, 400);
  const id = body.id;
  const pkg = normPkg(body.pkg);
  const meta = metaAttribution(body.fbclid, body.fbc);
  const fillMeta = {
    fbclid: sql`coalesce(${leads.fbclid}, ${meta.fbclid})`,
    fbc: sql`case when ${leads.fbclid} is null or ${leads.fbclid} = ${meta.fbclid}
      then coalesce(${leads.fbc}, ${meta.fbc}) else ${leads.fbc} end`,
  };

  if (new URL(req.url).pathname.endsWith("/checkout")) {
    // Only move forward: a paid or delivered lead never goes back to "checkout".
    await db
      .update(leads)
      .set({
        status: "checkout",
        ...(pkg ? { package: pkg } : {}),
        ...fillMeta,
        checkoutAt: sql`coalesce(${leads.checkoutAt}, now())`,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, id), inArray(leads.status, ["new", "checkout"])));
    return json({ ok: true });
  }

  const quiz = {
    name: clean(body.name, 120),
    whatsapp: clean(body.whatsapp, 40),
    interest: clean(body.interest, 60),
    dob: clean(body.dob, 60),
    ethnicity: clean(body.ethnicity, 120),
    consent: body.consent === true,
    package: pkg,
    language: normLang(body.lang),
  };
  const attribution = {
    utmSource: clean(body.utm_source),
    utmMedium: clean(body.utm_medium),
    utmCampaign: clean(body.utm_campaign),
    utmContent: clean(body.utm_content),
    utmTerm: clean(body.utm_term),
    referrer: clean(body.referrer, 1000),
    ...meta,
    landingUrl: clean(body.landing_url, 1000),
  };

  // Re-taking the quiz in the same visit updates the same lead instead of creating a duplicate.
  await db
    .insert(leads)
    .values({ id, ...quiz, ...attribution })
    .onConflictDoUpdate({
      target: leads.id,
      set: { ...quiz, ...fillMeta, package: sql`case when ${leads.status} = 'new'
        then coalesce(${pkg}, ${leads.package}) else ${leads.package} end`, updatedAt: new Date() },
    });
  return json({ ok: true });
};

export const config: Config = {
  path: ["/api/leads", "/api/leads/checkout"],
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
