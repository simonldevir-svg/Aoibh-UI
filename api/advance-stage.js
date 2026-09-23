// POST /api/advance-stage
// Body: { briefId, stage }
// Sets a brief's pipeline_stage — the tracker dashboard.html shows above
// the payment-status chip. An internal tracking correction, not a
// client-facing milestone (no email sent) — the client-facing moments
// (deposit confirmed, preview ready, project complete) are already
// covered elsewhere.
//
// `stage` is restricted to the 7 non-terminal values — "delivered" is
// deliberately rejected here and only ever set by api/mark-delivered.js,
// which also enforces the deliverables-exist guard and sends the
// completion email. Keeping the terminal transition on one code path
// avoids two different places setting "delivered" inconsistently.
//
// Free-form correction is allowed (not forward-only): the real pipeline
// loops — sent_to_client -> changes_requested -> designer_revising ->
// re_checked can repeat for a second revision round — so a monotonic
// guard would either block a legitimate second round or need special
// casing. Not worth it for a single-admin tool already gated behind a
// session cookie.
//
// Requires a valid aoibh_staff_session cookie (see api/auth-session.js).

const VALID_STAGES = [
  "brief_received",
  "matched",
  "drafts_created",
  "sent_to_client",
  "changes_requested",
  "designer_revising",
  "re_checked",
];

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const staffEmail = await requireStaffSession(req);
  if (!staffEmail) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const briefId = ((req.body && req.body.briefId) || "").trim();
  const stage = ((req.body && req.body.stage) || "").trim();

  if (!briefId) {
    return res.status(400).json({ error: "Missing briefId" });
  }
  if (stage === "delivered") {
    return res.status(400).json({ error: "Use \"Mark as delivered\" instead — it also unlocks the client's files." });
  }
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(", ")}` });
  }

  try {
    const patchRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(briefId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ pipeline_stage: stage }),
      }
    );
    if (!patchRes.ok) {
      console.error("advance-stage update error:", patchRes.status, await patchRes.text());
      return res.status(502).json({ error: "Failed to update stage" });
    }
    const rows = await patchRes.json();
    if (!rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.status(200).json({ ok: true, pipelineStage: stage });
  } catch (err) {
    console.error("advance-stage failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
