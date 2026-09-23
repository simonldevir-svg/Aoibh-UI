// POST /api/match-designer
// Body: { answers: { project, budget, deadline, assets }, email, name }
// Returns: { designer: { id, name, title, experience, location, img }, reason, confidence, source }
//
// Called ONCE per completed brief, right after the summary card renders.
// Picks the best-fit profile from the same 6 real, photographed designers
// shown on the Studio gallery (below) and has Claude write a one-line
// reason tying the pick to specifics from the brief, plus a 0-100
// confidence score. The frontend only shows a designer card when
// confidence is 80+; below that it hands off to a human producer instead.
// If the API call fails, times out, or returns something malformed, we
// fall back to a simple keyword-matching heuristic over the same roster —
// so a designer card (or a clean human hand-off) always renders, brief or
// no brief AI.
//
// Every completed brief (AI-matched or fallback-matched) is saved to
// Supabase's `briefs` table via saveBrief(), and a notification email is
// sent via Resend if RESEND_API_KEY is configured.

// Fallback only — the real source of truth is Supabase's `designers`
// table (see fetchDesigners below). Used only if that table can't be
// reached, so a brief can still always be matched to someone. Roster
// deliberately matches the 6 real, photographed designers shown on the
// main site's Studio gallery (index.html #gallery) — not a separate
// fictional list. Putting a real person's photo under a made-up identity
// would be worse than no photo at all, so this roster and the gallery are
// kept as the same 6 people, on purpose.
const FALLBACK_ROSTER = [
  {
    id: "eve-berlin",
    name: "Eve",
    title: "Brand Identity Designer",
    experience: "9 years",
    location: "Berlin, DE",
    img: "assets/designers/eve_berlin.jpeg",
    tags: ["branding", "identity", "logo", "startup", "rebrand", "naming"],
  },
  {
    id: "zac-sf",
    name: "Zac",
    title: "Product & UX Designer",
    experience: "7 years",
    location: "San Francisco, US",
    img: "assets/designers/zac_melbourne.jpg",
    tags: ["ux", "ui", "product", "app", "saas", "web app", "dashboard"],
  },
  {
    id: "nicole-paris",
    name: "Nicole",
    title: "Web & Editorial Designer",
    experience: "10 years",
    location: "Paris, FR",
    img: "assets/designers/nicole_paris.jpeg",
    tags: ["website", "web design", "landing page", "editorial", "marketing site", "layout"],
  },
  {
    id: "gemma-melbourne",
    name: "Gemma",
    title: "Motion & Video Designer",
    experience: "6 years",
    location: "London, UK",
    img: "assets/designers/gemma_melbourne.jpeg",
    tags: ["motion", "video", "animation", "reel", "social video", "trailer"],
  },
  {
    id: "marc-belfast",
    name: "Marc",
    title: "Packaging & Print Designer",
    experience: "11 years",
    location: "Belfast, UK",
    img: "assets/designers/marc_belfast.jpeg",
    tags: ["packaging", "print", "label", "product design", "retail"],
  },
  {
    id: "naomi-copenhagen",
    name: "Naomi",
    title: "Illustration & Social Content Designer",
    experience: "5 years",
    location: "Copenhagen, DK",
    img: "assets/designers/naomi_copenhagen.jpeg",
    tags: ["illustration", "social media", "content", "campaign", "instagram", "character"],
  },
];

// Art directors handle quality review/oversight on completed work — not
// matched to a brief's specifics the way designers are, so assignment is
// just a random pick among the current team rather than skill-based.
// Fallback only — see FALLBACK_ROSTER comment above.
const FALLBACK_ART_DIRECTOR_ROSTER = [
  { id: "hannah-london", name: "Hannah", location: "London, UK", img: "assets/designers/hanna_london.jpeg" },
  { id: "michael-manchester", name: "Michael", location: "Manchester, UK", img: "assets/designers/michael_manchester.jpeg" },
  { id: "tina-amsterdam", name: "Tina", location: "Amsterdam, NL", img: "assets/designers/Tina_amsterdam.jpeg" },
];

// Reads the live roster from Supabase's `designers` table — the real
// source of truth, editable there without touching code. Falls back to
// the hardcoded list above (fail soft, same philosophy as the rest of
// this file) if the table can't be reached or comes back empty.
async function fetchDesigners(role, fallback) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return fallback;
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/designers?role=eq.${role}&active=eq.true&select=id,name,title,experience,location,img,tags&order=name.asc`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!res.ok) {
      console.error("fetchDesigners error:", role, res.status, await res.text());
      return fallback;
    }
    const rows = await res.json();
    return rows.length > 0 ? rows : fallback;
  } catch (err) {
    console.error("fetchDesigners failed:", role, err.message);
    return fallback;
  }
}

function briefText(answers) {
  return Object.values(answers || {}).filter(Boolean).join(" ").toLowerCase();
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

const TIER_PROJECT_CAPS = { starter: 1, growth: 3 };

// Looks up the subscriber tied to the current request's session cookie,
// if any — this is what lets a subscriber start a project without the
// deposit/balance flow, gated by their plan's per-billing-period cap.
// Returns null for any non-subscriber (or invalid/expired session)
// request, which is the common case and leaves the existing trial flow
// completely unaffected.
async function getRequestingSubscriber(req) {
  const token = getCookie(req, "aoibh_subscriber_session");
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/subscriber_sessions?token=eq.${encodeURIComponent(token)}&select=expires_at,subscribers(id,email,tier,status,current_period_start)&limit=1`,
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
    if (!session || new Date(session.expires_at) < new Date() || !session.subscribers) return null;
    return session.subscribers;
  } catch (err) {
    console.error("getRequestingSubscriber failed:", err.message);
    return null;
  }
}

// Computed check against existing briefs rows, not a stored counter —
// naturally resets each period since current_period_start advances on
// renewal (see api/stripe-webhook.js's handleSubscriptionUpdated).
async function countSubscriberProjectsThisPeriod(subscriberId, periodStart) {
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
    if (!res.ok) return 0;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch (err) {
    console.error("countSubscriberProjectsThisPeriod failed:", err.message);
    return 0;
  }
}

// Saves every completed brief to Supabase and sends a notification email
// via Resend. Both steps fail soft — if Supabase or Resend has a problem,
// we log it and move on rather than breaking the response the user sees.
async function saveBrief({ email, name, answers, result, artDirectorRoster, subscriberId }) {
  let briefId = null;
  let jobNumber = null;
  const artDirector = artDirectorRoster[Math.floor(Math.random() * artDirectorRoster.length)];

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supaRes = await fetch(process.env.SUPABASE_URL + "/rest/v1/briefs", {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          email: email || null,
          name: name || null,
          answers: answers,
          matched_designer_id: result.designer.id,
          match_reason: result.reason,
          confidence: result.confidence,
          source: result.source,
          art_director_id: artDirector.id,
          pipeline_stage: "matched",
          ...(subscriberId ? { subscriber_id: subscriberId, payment_status: "covered_by_subscription" } : {}),
        }),
      });
      if (!supaRes.ok) {
        console.error("saveBrief supabase error:", supaRes.status, await supaRes.text());
      } else {
        const rows = await supaRes.json();
        briefId = rows && rows[0] && rows[0].id ? rows[0].id : null;
        jobNumber = rows && rows[0] && rows[0].job_number ? rows[0].job_number : null;
      }
    } catch (err) {
      console.error("saveBrief failed:", err.message);
    }
  }

  if (process.env.RESEND_API_KEY) {
    try {
      const answersList = Object.entries(answers || {})
        .map(([k, v]) => `${k}: ${v || "—"}`)
        .join("\n");

      const dashboardLine = briefId
        ? `\n\nJob #${jobNumber || "—"}\nView dashboard: https://aoibh.ai/dashboard.html?id=${briefId}&email=${encodeURIComponent(email || "")}`
        : "";

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Aoibh Leads <leads@aoibh.ai>",
          to: ["hello@aoibh.ai"],
          subject: `New brief: ${name || email || "anonymous"} matched to ${result.designer.name}${subscriberId ? " (subscription)" : ""}`,
          text: `New brief submitted.\n\nName: ${name || "—"}\nEmail: ${email || "—"}\n\nAnswers:\n${answersList}\n\nMatched designer: ${result.designer.name} (${result.confidence}% confidence, source: ${result.source})\nReason: ${result.reason}${dashboardLine}`,
        }),
      });
    } catch (err) {
      console.error("sendLeadEmail failed:", err.message);
    }

    // Subscriber-covered projects skip the deposit stage entirely, so
    // there's no stripe-webhook "deposit confirmed" moment to notify the
    // client from — send that confirmation here instead.
    if (subscriberId && briefId && email) {
      try {
        const dashboardUrl = `https://aoibh.ai/dashboard.html?id=${briefId}&email=${encodeURIComponent(email)}`;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Aoibh <hello@aoibh.ai>",
            to: [email],
            subject: "Your project is underway",
            text: `Hi${name ? " " + name : ""},\n\n${result.designer.name} is getting started on your project now — included in your subscription, no payment needed.\n\nTrack progress here: ${dashboardUrl}\n\n— Aoibh`,
          }),
        });
      } catch (err) {
        console.error("sendSubscriberProjectStartedEmail failed:", err.message);
      }
    }
  }

  return { briefId, jobNumber };
}

// Deterministic fallback used when the API is unavailable or misbehaves —
// simple keyword overlap against each designer's tags, defaulting to the
// first roster entry (Eve) if nothing scores. Confidence is a base rate
// plus a bump per matched tag, capped just under 100 — mirrors the
// equivalent heuristic in index.html's client-side fallback.
function fallbackMatch(answers, roster) {
  const text = briefText(answers);
  let best = roster[0];
  let bestScore = -1;
  for (const designer of roster) {
    const score = designer.tags.reduce((acc, tag) => acc + (text.includes(tag) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = designer;
    }
  }
  const confidence = Math.min(97, 55 + bestScore * 14);
  return {
    designer: { id: best.id, name: best.name, title: best.title, experience: best.experience, location: best.location, img: best.img, tags: best.tags },
    reason: `${best.name} works well across ${best.title.toLowerCase()} projects like this one.`,
    confidence,
    source: "fallback",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const answers = (req.body && req.body.answers) || {};
  let email = (req.body && req.body.email || "").trim();
  const name = (req.body && req.body.name || "").trim();

  // A subscriber's identity and cap are established from their own
  // session cookie, never from the request body — otherwise a client
  // could just claim to be any subscriber's email to skip payment.
  let subscriberId = null;
  const subscriber = await getRequestingSubscriber(req);
  if (subscriber) {
    if (subscriber.status !== "active") {
      return res.status(403).json({
        error: "Your subscription isn't active — please update your payment method to start a new project.",
      });
    }
    const cap = TIER_PROJECT_CAPS[subscriber.tier];
    const used = await countSubscriberProjectsThisPeriod(subscriber.id, subscriber.current_period_start);
    if (cap != null && used >= cap) {
      return res.status(403).json({
        error: `You've used all ${cap} project${cap === 1 ? "" : "s"} included in your plan this billing period.`,
      });
    }
    email = subscriber.email;
    subscriberId = subscriber.id;
  }

  const [roster, artDirectorRoster] = await Promise.all([
    fetchDesigners("designer", FALLBACK_ROSTER),
    fetchDesigners("art_director", FALLBACK_ART_DIRECTOR_ROSTER),
  ]);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const fallbackResult = fallbackMatch(answers, roster);
    const { briefId, jobNumber } = await saveBrief({ email, name, answers, result: fallbackResult, artDirectorRoster, subscriberId });
    return res.status(200).json({ ...fallbackResult, briefId, jobNumber });
  }

  const rosterForPrompt = roster.map(
    ({ id, name, title, experience, location, tags }) => ({ id, name, title, experience, location, tags })
  );

  const systemPrompt = `You are matching a client brief to one designer from
Aoibh's marketplace roster. You will be given the roster as JSON and the
client's brief answers. Pick the single best-fit designer for this specific
project, based on their title and tags versus what the brief needs. Also
score your own confidence in this match from 0-100, based on how clearly
the brief's specifics (project type, assets needed, budget, timeline) align with
that designer's title and tags — a vague or generic brief should score
lower than one with specific, on-tag details.

Roster:
${JSON.stringify(rosterForPrompt, null, 2)}

Respond ONLY with JSON, no prose, no markdown fences, in this exact shape:
{"designerId":"<one of the ids above>","reason":"<one sentence, under 28 words, explaining why this designer fits THIS brief specifically>","confidence":<integer 0-100>}`;

  const userContent = `Brief answers:
${Object.entries(answers).map(([k, v]) => `${k}: ${v || "—"}`).join("\n")}

Pick the designer now.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) throw new Error(`Anthropic API error: ${r.status}`);

    const data = await r.json();
    const raw = data.content?.[0]?.text ?? "";
    const parsed = JSON.parse(raw);

    const match = roster.find((d) => d.id === parsed.designerId);
    if (!match || typeof parsed.reason !== "string" || !parsed.reason.trim()) {
      throw new Error("Malformed or unknown designer id from model");
    }
    if (typeof parsed.confidence !== "number" || Number.isNaN(parsed.confidence)) {
      throw new Error("Missing or malformed confidence from model");
    }
    const confidence = Math.max(0, Math.min(100, Math.round(parsed.confidence)));

    const result = {
      designer: {
        id: match.id,
        name: match.name,
        title: match.title,
        experience: match.experience,
        location: match.location,
        img: match.img,
        tags: match.tags,
      },
      reason: parsed.reason.trim(),
      confidence,
      source: "ai",
    };
    const { briefId, jobNumber } = await saveBrief({ email, name, answers, result, artDirectorRoster, subscriberId });
    return res.status(200).json({ ...result, briefId, jobNumber });
  } catch (err) {
    // Network error, timeout, bad JSON, or an id not in the roster — always
    // fail soft to the deterministic match rather than leaving the client
    // with no designer at all.
    console.error("match-designer failed:", err.message);
    const fallbackResult = fallbackMatch(answers, roster);
    const { briefId, jobNumber } = await saveBrief({ email, name, answers, result: fallbackResult, artDirectorRoster, subscriberId });
    return res.status(200).json({ ...fallbackResult, briefId, jobNumber });
  }
}
