// netlify/functions/create-checkout.js
// Creates a Stripe Checkout Session in EMBEDDED mode so the payment form
// loads right inside the funnel's checkout view (no redirect to buy.stripe.com).
//
// Netlify → Site settings → Environment variables:
//   STRIPE_SECRET_KEY        sk_live_...   (server-side only, never in the HTML)
//   STRIPE_PUBLISHABLE_KEY   pk_live_...   (returned to the page so Stripe.js can mount)
//   STRIPE_PRICE_BASIC       price_...     (optional — the €17 EUR price; inline €17 used if unset)
//   STRIPE_PRICE_COMPLETE    price_...     (optional — the €37 EUR price; inline €37 used if unset)
//
// If the keys are not set, the page falls back to the Stripe Payment Links.

const PACKAGES = {
  basic:    { name: 'Basic Soulmate Sketch',    amount: 1700, priceEnv: 'STRIPE_PRICE_BASIC' },
  complete: { name: 'Complete Soulmate Vision', amount: 3700, priceEnv: 'STRIPE_PRICE_COMPLETE' },
};

exports.handler = async (event) => {
  const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const secret = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!secret || !publishableKey) return json(500, { error: 'Stripe keys are not set in Netlify environment variables' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Invalid JSON' }); }

  const pkgKey = body.pkg === 'basic' ? 'basic' : 'complete';
  const pkg = PACKAGES[pkgKey];
  const origin = (event.headers.origin || `https://${event.headers.host}`).replace(/\/$/, '');

  const form = new URLSearchParams();
  form.append('ui_mode', 'embedded');
  form.append('mode', 'payment');
  // Localised funnels (/fr/, /ger/) send their language so the buyer returns to the same-language thank-you page.
  const LANGS = { fr: { path: '/fr/', locale: 'fr' }, ger: { path: '/ger/', locale: 'de' } };
  const lang = Object.prototype.hasOwnProperty.call(LANGS, body.lang) ? LANGS[body.lang] : null;
  form.append('return_url', `${origin}${lang ? lang.path : '/'}?paid=${pkgKey}&session_id={CHECKOUT_SESSION_ID}#thankyou`);
  if (lang) form.append('locale', lang.locale);
  // Links the Stripe order back to the lead row in the CRM (see /admin).
  const leadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.leadId || '') ? body.leadId : null;
  if (leadId) form.append('client_reference_id', leadId);
  form.append('line_items[0][quantity]', '1');
  const priceId = process.env[pkg.priceEnv];
  if (priceId) {
    form.append('line_items[0][price]', priceId);
  } else {
    form.append('line_items[0][price_data][currency]', 'eur');
    form.append('line_items[0][price_data][unit_amount]', String(pkg.amount));
    form.append('line_items[0][price_data][product_data][name]', pkg.name);
  }
  // Quiz answers travel with the order so Naya can see who to draw for, right in the Stripe dashboard.
  const meta = { lead_id: leadId, package: pkgKey, language: lang ? lang.locale : 'en', name: body.name, whatsapp: body.whatsapp, interest: body.interest, dob: body.dob, ethnicity: body.ethnicity };
  Object.keys(meta).forEach((k) => { if (meta[k]) form.append(`metadata[${k}]`, String(meta[k]).slice(0, 450)); });
  form.append('phone_number_collection[enabled]', 'false');

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: form.toString(),
  });
  const data = await res.json();
  if (!res.ok) return json(res.status, { error: (data.error && data.error.message) || 'Stripe error' });
  return json(200, { clientSecret: data.client_secret, publishableKey });
};
