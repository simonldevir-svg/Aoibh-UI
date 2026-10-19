// POST   /api/funnel-spend   body { week_start: "YYYY-MM-DD", campaign, amount, note? }  — record a week's ad spend
// DELETE /api/funnel-spend?id=<id>                                                           — remove an entry
// Staff-session gated. Spend is typed in by hand (copied from Google Ads) so funnel.html can work
// out cost per brief and cost per paid deposit. `campaign` must match the ad's utm_campaign.

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

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Supabase not configured" });
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!(await requireStaffSession(req))) return res.status(401).json({ error: "unauthorized" });

  try {
    if (req.method === "DELETE") {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
      const r = await supa(`funnel_spend?id=eq.${id}`, { method: "DELETE" });
      if (!r.ok) {
        console.error("funnel-spend delete failed:", r.status, (await r.text()).slice(0, 200));
        return res.status(502).json({ error: "Could not delete" });
      }
      return res.status(200).json({ ok: true });
    }

    const { week_start, campaign, amount, note } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start || "")) return res.status(400).json({ error: "Pick the week start date" });
    const camp = String(campaign || "").replace(/[\u0000-\u001f\u007f<>"'`]/g, "").trim().slice(0, 100);
    if (!camp) return res.status(400).json({ error: "Enter the campaign name (it must match utm_campaign)" });
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || value > 100000) return res.status(400).json({ error: "Enter the spend as a number" });
    const cleanNote = note ? String(note).replace(/[\u0000-\u001f\u007f<>"'`]/g, "").trim().slice(0, 200) : null;

    const r = await supa("funnel_spend", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ week_start, campaign: camp, amount_cents: Math.round(value * 100), note: cleanNote }),
    });
    if (!r.ok) {
      console.error("funnel-spend insert failed:", r.status, (await r.text()).slice(0, 200));
      return res.status(502).json({ error: "Could not save. Has the funnel SQL been run in Supabase?" });
    }
    const rows = await r.json();
    return res.status(200).json({ ok: true, entry: rows[0] || null });
  } catch (err) {
    console.error("funnel-spend failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
