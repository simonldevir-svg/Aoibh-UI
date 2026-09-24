// GET/POST /api/messages
// A project-scoped message thread between a client and staff — an open
// channel, no logistics/feedback restriction (same as email today, just
// moved into the dashboard). Deliberately simpler than the AI-mediated
// design originally sketched in Research/backend-architecture-proposal.md
// section 6 — no real revision-feedback mechanism exists on the live
// dashboard to redirect to anyway, so this isn't a new risk, just today's
// unstructured "email us" channel given a real home.
//
// GET  ?id=<briefId>&email=<email>   (client) or ?id=<briefId> + a staff
//      session cookie (staff) -> { messages: [{id, sender, body, createdAt}] }
// POST { briefId, email?, body }      -> inserts with sender DERIVED from
//      whichever auth path succeeded — never trusted from the request body.
//
// This endpoint has two equally valid callers (unlike every other staff
// gate in this codebase), so a missing/invalid staff cookie is NOT a 401 —
// it just falls through to the client id+email check. Only 400 (missing
// param) and 404 (brief not found / email mismatch, same non-leaking shape
// as api/dashboard-data.js) are returned.

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function requireStaffSession(req) {
  const token = getCookie(req, "aoibh_staff_session");
  if (!token) return null;
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/staff_sessions?token=eq.${encodeURIComponent(token)}&select=email,expires_at&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const session = rows[0];
    if (!session || new Date(session.expires_at) < new Date()) return null;
    return session.email;
  } catch (err) {
    console.error("requireStaffSession failed:", err.message);
    return null;
  }
}

async function fetchBrief(briefId) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(briefId)}&select=id,name,email&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// Returns { sender: 'staff' } | { sender: 'client', brief } | { error, message }
async function authenticate(req, briefId, email) {
  const staffEmail = await requireStaffSession(req);
  if (staffEmail) return { sender: "staff" };

  if (!email) return { error: 400, message: "Missing required param: email" };

  const brief = await fetchBrief(briefId);
  if (!brief || (brief.email || "").trim().toLowerCase() !== email.trim().toLowerCase()) {
    return { error: 404, message: "Project not found" };
  }
  return { sender: "client", brief };
}

async function sendEmail({ to, from, subject, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.error("sendEmail skipped: RESEND_API_KEY not set");
    return;
  }
  if (!to) {
    console.error("sendEmail skipped: no recipient");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error("sendEmail rejected by Resend:", res.status, await res.text());
    }
  } catch (err) {
    console.error("sendEmail failed:", err.message);
  }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  if (req.method === "GET") {
    const id = ((req.query && req.query.id) || "").trim();
    const email = ((req.query && req.query.email) || "").trim();
    if (!id) return res.status(400).json({ error: "Missing required query param: id" });

    const auth = await authenticate(req, id, email);
    if (auth.error) return res.status(auth.error).json({ error: auth.message });

    try {
      const msgRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/messages?brief_id=eq.${encodeURIComponent(id)}&select=id,sender,body,created_at&order=created_at.asc`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          },
        }
      );
      if (!msgRes.ok) {
        console.error("messages GET error:", msgRes.status, await msgRes.text());
        return res.status(502).json({ error: "Failed to load messages" });
      }
      const rows = await msgRes.json();
      return res.status(200).json({
        messages: rows.map((r) => ({ id: r.id, sender: r.sender, body: r.body, createdAt: r.created_at })),
      });
    } catch (err) {
      console.error("messages GET failed:", err.message);
      return res.status(500).json({ error: "Unexpected error" });
    }
  }

  if (req.method === "POST") {
    const briefId = ((req.body && req.body.briefId) || "").trim();
    const bodyText = ((req.body && req.body.body) || "").trim();
    const email = ((req.body && req.body.email) || "").trim();

    if (!briefId) return res.status(400).json({ error: "Missing briefId" });
    if (!bodyText) return res.status(400).json({ error: "Missing body" });

    const auth = await authenticate(req, briefId, email);
    if (auth.error) return res.status(auth.error).json({ error: auth.message });

    const sender = auth.sender; // derived above — never trusted from req.body

    try {
      const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/messages`, {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ brief_id: briefId, sender, body: bodyText }),
      });
      if (!insertRes.ok) {
        console.error("messages POST insert error:", insertRes.status, await insertRes.text());
        return res.status(502).json({ error: "Failed to send message" });
      }
      const rows = await insertRes.json();
      const inserted = rows[0];
      if (!inserted) return res.status(404).json({ error: "Project not found" });

      const brief = sender === "client" ? auth.brief : await fetchBrief(briefId);
      if (brief) {
        if (sender === "client") {
          await sendEmail({
            to: "hello@aoibh.ai",
            from: "Aoibh Leads <leads@aoibh.ai>",
            subject: `New message from ${brief.name || brief.email}`,
            text: `New message from ${brief.name || "a client"} (${brief.email}) on their project:\n\n"${bodyText}"\n\nReply via the message thread in upload.html (brief id: ${briefId}).`,
          });
        } else {
          const dashboardUrl = `${process.env.SITE_URL}/dashboard.html?id=${briefId}&email=${encodeURIComponent(brief.email || "")}`;
          await sendEmail({
            to: brief.email,
            from: "Aoibh <hello@aoibh.ai>",
            subject: "New message on your project",
            text: `Hi ${brief.name || "there"},\n\nYou have a new message from your Aoibh team:\n\n"${bodyText}"\n\nReply here: ${dashboardUrl}\n\n— Aoibh`,
          });
        }
      }

      return res.status(200).json({
        ok: true,
        message: { id: inserted.id, sender, body: bodyText, createdAt: inserted.created_at },
      });
    } catch (err) {
      console.error("messages POST failed:", err.message);
      return res.status(500).json({ error: "Unexpected error" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
