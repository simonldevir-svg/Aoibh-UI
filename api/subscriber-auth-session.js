// api/subscriber-auth-session.js
// GET /api/subscriber-auth-session
// Returns { authenticated, email?, tier?, status?, currentPeriodEnd? }
// based on the aoibh_subscriber_session cookie. account.html calls this
// on load to decide whether to render or bounce to subscriber-login.html.

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

const TIER_PROJECT_CAPS = { starter: 1, growth: 3 };

// Same computed-count approach as api/match-designer.js's cap check —
// kept in sync deliberately, not shared via an import, matching this
// codebase's existing pattern of small per-file duplication over a
// shared utils module.
async function countProjectsThisPeriod(subscriberId, periodStart) {
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/briefs?subscriber_id=eq.${encodeURIComponent(subscriberId)}&created_at=gte.${encodeURIComponent(periodStart)}&select=id`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : null;
  } catch (err) {
    console.error("countProjectsThisPeriod failed:", err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(200).json({ authenticated: false });
  }

  const token = getCookie(req, "aoibh_subscriber_session");
  if (!token) return res.status(200).json({ authenticated: false });

  try {
    const sessRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/subscriber_sessions?token=eq.${encodeURIComponent(token)}&select=expires_at,subscribers(id,email,tier,status,current_period_start,current_period_end)&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!sessRes.ok) return res.status(200).json({ authenticated: false });
    const rows = await sessRes.json();
    const session = rows[0];
    if (!session || new Date(session.expires_at) < new Date() || !session.subscribers) {
      return res.status(200).json({ authenticated: false });
    }

    const sub = session.subscribers;
    const projectsCap = TIER_PROJECT_CAPS[sub.tier] ?? null;
    const projectsUsed = sub.current_period_start
      ? await countProjectsThisPeriod(sub.id, sub.current_period_start)
      : null;

    return res.status(200).json({
      authenticated: true,
      email: sub.email,
      tier: sub.tier,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      projectsUsed,
      projectsCap,
    });
  } catch (err) {
    console.error("subscriber-auth-session failed:", err.message);
    return res.status(200).json({ authenticated: false });
  }
}
