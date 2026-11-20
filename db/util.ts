// Small helpers shared by the lead/CRM functions.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STATUSES = ["new", "checkout", "paid", "delivered"] as const;
export type Status = (typeof STATUSES)[number];

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// Trim + cap a free-text value; empty becomes null.
export const clean = (v: unknown, max = 200): string | null => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s ? s : null;
};

export const normLang = (v: unknown): string => (v === "fr" || v === "de" ? v : "en");
export const normPkg = (v: unknown): string | null => (v === "basic" || v === "complete" ? v : null);

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
