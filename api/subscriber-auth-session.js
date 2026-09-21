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
      `${process.env.SUPABASE_URL}/rest/v1/subscriber_sessions?token=eq.${encodeURIComponent(token)}&select=expires_at,subscribers(email,tier,status,current_period_end)&limit=1`,
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
    return res.status(200).json({
      authenticated: true,
      email: session.subscribers.email,
      tier: session.subscribers.tier,
      status: session.subscribers.status,
      currentPeriodEnd: session.subscribers.current_period_end,
    });
  } catch (err) {
    console.error("subscriber-auth-session failed:", err.message);
    return res.status(200).json({ authenticated: false });
  }
}
