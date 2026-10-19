// Shared helpers for first-party funnel tracking. Not an endpoint (the leading underscore
// keeps Vercel from exposing it). See Research/funnel-migration.sql for the tables.
//
// Privacy by design: the tracking is cookie-free and anonymous. No IP address, no user-agent
// string and no visitor id is ever stored. Rows hold only what page, which button, which
// campaign tags, and (for server events) the brief id.
//
// Every write here fails soft. Tracking must never be able to break a brief or a payment.

export const PAGES = ["startups", "agencies", "home"];
export const CLIENT_EVENTS = ["view", "section_view", "cta_click", "plan_click", "brief_started"];
export const SECTIONS = ["hero", "problem", "how", "offer", "work", "proof", "pricing", "whitelabel", "faq", "final"];
const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trim, strip control characters and quote/angle characters, cap the length.
export function clean(v, max = 100) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>"'`]/g, "").trim().slice(0, max);
  return s || null;
}

export function cleanAttribution(a) {
  const out = {};
  for (const k of ATTR_KEYS) out[k] = a && typeof a === "object" ? clean(a[k], k === "gclid" ? 200 : 100) : null;
  return out;
}

export function cleanPage(p) {
  return PAGES.includes(p) ? p : "home";
}

export function envFromHost(host) {
  const h = String(host || "").toLowerCase().split(":")[0];
  return h === "aoibh.ai" || h === "www.aoibh.ai" ? "prod" : "preview";
}

export function looksLikeBot(ua) {
  return /bot|crawl|spider|slurp|adsbot|mediapartners|lighthouse|headless|preview|facebookexternalhit|curl|wget|python-requests|monitor/i.test(String(ua || ""));
}

export function validBriefId(id) {
  return typeof id === "string" && UUID.test(id) ? id : null;
}

function supa(path, options = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

export async function insertFunnelEvents(rows) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !rows || !rows.length) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await supa("funnel_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows), signal: ctl.signal });
    if (!r.ok) {
      console.error("funnel_events insert failed:", r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error("funnel_events insert error:", err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The campaign tags a brief arrived with (written when the brief was saved), so later events
// for that brief (deposit paid, balance paid) can be credited to the same ad.
export async function findBriefAttribution(briefId) {
  const empty = { page: null, ...cleanAttribution(null) };
  const id = validBriefId(briefId);
  if (!id || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return empty;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await supa(
      `funnel_events?brief_id=eq.${id}&event=eq.brief_saved&select=page,utm_source,utm_medium,utm_campaign,utm_term,utm_content,gclid&limit=1`,
      { signal: ctl.signal }
    );
    if (!r.ok) return empty;
    const rows = await r.json();
    return rows && rows[0] ? { ...empty, ...rows[0] } : empty;
  } catch (err) {
    console.error("findBriefAttribution error:", err.message);
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

// One server-side milestone (brief saved, deposit paid, balance paid, subscribed).
export async function logMilestone({ event, briefId, amountCents, attribution, page, host }) {
  try {
    const a = attribution || (await findBriefAttribution(briefId));
    await insertFunnelEvents([{
      event,
      page: page || a.page || "home",
      env: host ? envFromHost(host) : "prod",
      brief_id: validBriefId(briefId),
      amount_cents: Number.isInteger(amountCents) ? amountCents : null,
      ...cleanAttribution(a),
    }]);
  } catch (err) {
    console.error("logMilestone failed:", err.message);
  }
}
