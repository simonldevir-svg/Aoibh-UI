// POST /api/track
// Body (JSON, sent with navigator.sendBeacon from the landing pages and the home page):
//   { page, device, attr: { utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid },
//     events: [{ e: "view" | "section_view" | "cta_click" | "plan_click" | "brief_started", s?: section, c?: cta }] }
//
// Cookie-free, anonymous first-party counting (see api/_funnel.js). Always answers 204 so the
// browser never waits on, or reacts to, tracking. Known bots are ignored.

import { CLIENT_EVENTS, SECTIONS, clean, cleanAttribution, cleanPage, envFromHost, insertFunnelEvents, looksLikeBot } from "./_funnel.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  try {
    if (looksLikeBot(req.headers["user-agent"])) return res.status(204).end();

    let body = req.body;
    if (typeof body === "string") {
      if (body.length > 8000) return res.status(204).end();
      body = JSON.parse(body);
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.events)) return res.status(204).end();

    const page = cleanPage(body.page);
    const device = body.device === "mobile" ? "mobile" : "desktop";
    const attr = cleanAttribution(body.attr);
    const env = envFromHost(req.headers.host);

    const rows = [];
    for (const ev of body.events.slice(0, 12)) {
      if (!ev || !CLIENT_EVENTS.includes(ev.e)) continue;
      rows.push({
        event: ev.e,
        page,
        device,
        env,
        section: ev.e === "section_view" && SECTIONS.includes(ev.s) ? ev.s : null,
        cta: ev.e === "cta_click" || ev.e === "plan_click" ? clean(ev.c, 40) : null,
        ...attr,
      });
    }
    await insertFunnelEvents(rows);
  } catch (err) {
    console.error("track failed:", err.message);
  }
  return res.status(204).end();
}
