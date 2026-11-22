import { pgTable, uuid, text, boolean, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";

export type ManualPurchase = {
  fbc: string;
  amountCents: number;
  currency: string;
  eventTime: number;
  attemptedAt: number;
  state: "sending" | "failed" | "sent";
};

// One row per person who finishes the quiz. Status moves:
// new → checkout → paid (confirmed with Stripe) → delivered (set by hand in /admin).
export const leads = pgTable(
  "leads",
  {
    id: uuid().primaryKey(),
    status: text().notNull().default("new"),
    name: text(),
    whatsapp: text(),
    interest: text(),
    dob: text(),
    ethnicity: text(),
    consent: boolean().notNull().default(false),
    package: text(),
    language: text().notNull().default("en"),
    amountCents: integer("amount_cents"),
    currency: text(),
    customerEmail: text("customer_email"),
    stripeSessionId: text("stripe_session_id").unique(),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    referrer: text(),
    fbclid: text(),
    fbc: text(),
    manualPurchase: jsonb("manual_purchase").$type<ManualPurchase>(),
    landingUrl: text("landing_url"),
    notes: text().notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    checkoutAt: timestamp("checkout_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("leads_created_at_idx").on(t.createdAt), index("leads_status_idx").on(t.status)],
);

export type Lead = typeof leads.$inferSelect;
