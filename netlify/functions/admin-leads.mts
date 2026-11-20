// Admin API for the mini CRM at /admin. Every request needs the ADMIN_PASSWORD
// (Netlify environment variable) as a Bearer token.
//   GET    /api/admin/leads                       — list all leads, newest first
//   PATCH  /api/admin/leads { id, status?, notes? } — update status / notes
//   DELETE /api/admin/leads { id }                 — remove a test or junk lead
import type { Config } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { leads } from "../../db/schema.js";
import { STATUSES, isUuid, json, type Status } from "../../db/util.js";

const digest = (v: string) => createHash("sha256").update(v).digest();

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
