// netlify/functions/meta-capi.js
// Meta Conversions API — server-side only.
// The access token is NEVER in this file or in the HTML.
// Set it in Netlify: Site settings → Environment variables → META_CAPI_TOKEN
// Pixel ID is public and lives in the funnel HTML (2396469624443898).
const crypto = require('crypto');

const PIXEL_ID = '2396469624443898';
const API_VERSION = 'v21.0';

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normPhone(value) {
  if (!value) return undefined;
  const digits = String(value).replace(/\D/g, '');
  return digits ? sha256(digits) : undefined;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }
  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'META_CAPI_TOKEN is not set in Netlify environment variables' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const now = Math.floor(Date.now() / 1000);
  const userData = {};
  if (body.email) userData.em = [sha256(body.email)];
  if (body.phone) userData.ph = [normPhone(body.phone)];
  if (body.firstName) userData.fn = [sha256(body.firstName)];
  if (body.clientIp) userData.client_ip_address = body.clientIp;
  if (body.userAgent) userData.client_user_agent = body.userAgent;
  if (body.fbp) userData.fbp = body.fbp;
  if (body.fbc) userData.fbc = body.fbc;

  const payload = {
    data: [{
      event_name: body.eventName || 'PageView',
      event_time: body.eventTime || now,
      event_id: body.eventId || `${body.eventName || 'PageView'}-${now}`,
      event_source_url: body.eventSourceUrl,
      action_source: 'website',
      user_data: userData,
      custom_data: body.customData || {},
    }],
    test_event_code: body.testEventCode || undefined,
  };

  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { statusCode: res.status, body: JSON.stringify(data) };
};
