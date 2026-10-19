// GET /api/funnel-stats?from=YYYY-MM-DD&to=YYYY-MM-DD&src=google|all&env=prod|all
// Staff-session gated (same cookie check as upload-deliverable.js). Aggregates funnel_events
// and funnel_spend for funnel.html: totals, per landing page, per campaign / keyword / ad,
// per-section reach and per-button clicks. Counts are raw page loads, not unique visitors
// (the tracking is cookie-free, so a refresh counts twice).

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
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

async function requireStaffSession(req) {
  const token = getCookie(req, "aoibh_staff_session");
  if (!token) return null;
  try {
    const res = await supa(`staff_sessions?token=eq.${encodeURIComponent(token)}&select=email,expires_at&limit=1`);
    if (!res.ok) return null;
    const session = (await res.json())[0];
    if (!session || new Date(session.expires_at) < new Date()) return null;
    return session.email;
  } catch (err) {
    console.error("requireStaffSession failed:", err.message);
    return null;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => d.toISOString().slice(0, 10);
const blank = () => ({ view: 0, cta_click: 0, plan_click: 0, brief_started: 0, brief_saved: 0, deposit_paid: 0, balance_paid: 0, subscribed: 0, revenue_cents: 0 });

function addTo(map, key, row) {
  const k = key || "(none)";
  if (!map[k]) map[k] = blank();
  if (map[k][row.event] !== undefined) map[k][row.event] += 1;
  if (["deposit_paid", "balance_paid", "subscribed"].includes(row.event) && Number.isInteger(row.amount_cents)) map[k].revenue_cents += row.amount_cents;
}

const toList = (map) => Object.entries(map).map(([key, m]) => ({ key, ...m })).sort((a, b) => b.view - a.view || b.brief_saved - a.brief_saved);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Supabase not configured" });
  if (!(await requireStaffSession(req))) return res.status(401).json({ error: "unauthorized" });

  try {
    const today = new Date();
    const to = DATE.test(req.query.to || "") ? req.query.to : iso(today);
    const from = DATE.test(req.query.from || "") ? req.query.from : iso(new Date(today.getTime() - 13 * 86400000));
    const toExclusive = iso(new Date(new Date(to + "T00:00:00Z").getTime() + 86400000));
    const src = req.query.src === "all" ? "all" : "google";
    const env = req.query.env === "all" ? "all" : "prod";

    let q = `select=*&created_at=gte.${from}T00:00:00Z&created_at=lt.${toExclusive}T00:00:00Z`;
    if (env === "prod") q += "&env=eq.prod";
    if (src === "google") q += "&utm_source=ilike.google";

    const rows = [];
    let truncated = false;
    for (let off = 0; off < 30000; off += 1000) {
      const r = await supa(`funnel_events?${q}&order=id.asc`, { headers: { "Range-Unit": "items", Range: `${off}-${off + 999}` } });
      if (!r.ok) {
        const text = await r.text();
        if (r.status === 404 || /does not exist|schema cache/i.test(text)) return res.status(200).json({ setup: true });
        console.error("funnel-stats fetch failed:", r.status, text.slice(0, 200));
        return res.status(502).json({ error: "Could not read funnel data" });
      }
      const batch = await r.json();
      rows.push(...batch);
      if (batch.length < 1000) break;
      if (off + 1000 >= 30000) truncated = true;
    }

    const total = blank();
    const pages = {}, campaign = {}, term = {}, content = {};
    const sections = {}, ctas = {};
    const devices = { mobile: blank(), desktop: blank() };
    let lastEventAt = null;

    for (const row of rows) {
      lastEventAt = row.created_at;
      if (total[row.event] !== undefined) total[row.event] += 1;
      if (["deposit_paid", "balance_paid", "subscribed"].includes(row.event) && Number.isInteger(row.amount_cents)) total.revenue_cents += row.amount_cents;
      addTo(pages, row.page, row);
      addTo(campaign, row.utm_campaign, row);
      addTo(term, row.utm_term, row);
      addTo(content, row.utm_content, row);
      if (row.device && devices[row.device] && devices[row.device][row.event] !== undefined) devices[row.device][row.event] += 1;
      if (row.event === "section_view" && row.section) {
        sections[row.page] = sections[row.page] || {};
        sections[row.page][row.section] = (sections[row.page][row.section] || 0) + 1;
      }
      if (row.event === "cta_click" && row.cta) {
        ctas[row.page] = ctas[row.page] || {};
        ctas[row.page][row.cta] = (ctas[row.page][row.cta] || 0) + 1;
      }
    }

    // Spend for weeks that start inside the range (plus the week before, which can overlap it)
    const spendFrom = iso(new Date(new Date(from + "T00:00:00Z").getTime() - 6 * 86400000));
    let spend = [];
    const sr = await supa(`funnel_spend?week_start=gte.${spendFrom}&week_start=lte.${to}&select=id,week_start,campaign,amount_cents,note&order=week_start.desc`);
    if (sr.ok) spend = await sr.json();
    const spendByCampaign = {};
    let spendTotal = 0;
    for (const s of spend) {
      spendByCampaign[s.campaign] = (spendByCampaign[s.campaign] || 0) + s.amount_cents;
      spendTotal += s.amount_cents;
    }

    return res.status(200).json({
      range: { from, to, src, env },
      truncated,
      lastEventAt,
      eventCount: rows.length,
      total,
      devices,
      pages: toList(pages),
      campaign: toList(campaign),
      term: toList(term),
      content: toList(content),
      sections,
      ctas,
      spend: { total_cents: spendTotal, by_campaign: spendByCampaign, entries: spend },
    });
  } catch (err) {
    console.error("funnel-stats failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
