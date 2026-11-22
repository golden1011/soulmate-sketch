import type { ManualPurchase } from "../../db/schema.js";

export async function sendManualPurchase(id: string, purchase: ManualPurchase): Promise<boolean> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return false;

  try {
    const response = await fetch("https://graph.facebook.com/v21.0/2396469624443898/events", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: [{
        event_name: "Purchase",
        event_time: purchase.eventTime,
        event_id: `manual-purchase-${id}`,
        action_source: "other",
        user_data: { fbc: purchase.fbc },
        custom_data: { value: purchase.amountCents / 100, currency: purchase.currency },
      }] }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.events_received === 1;
  } catch {
    return false;
  }
}
