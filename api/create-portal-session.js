// api/create-portal-session.js
// POST /api/create-portal-session
// Authenticated via the aoibh_subscriber_session cookie (same pattern as
// api/subscriber-auth-session.js) — looks up the subscriber's Stripe
// customer id and creates a real Stripe Customer Portal session, where
// they can update their card, change plans, or cancel entirely. Requires
// the Customer Portal to be turned on in the Stripe dashboard first
// (Settings -> Billing -> Customer portal) — this endpoint just creates
// a session against whatever's configured there.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const token = getCookie(req, "aoibh_subscriber_session");
  if (!token) {
    return res.status(401).json({ error: "Not signed in" });
  }

  try {
    const sessRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/subscriber_sessions?token=eq.${encodeURIComponent(token)}&select=expires_at,subscribers(stripe_customer_id)&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!sessRes.ok) throw new Error(`session lookup failed: ${sessRes.status}`);
    const rows = await sessRes.json();
    const session = rows[0];

    if (!session || new Date(session.expires_at) < new Date() || !session.subscribers?.stripe_customer_id) {
      return res.status(401).json({ error: "Not signed in" });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: session.subscribers.stripe_customer_id,
      return_url: `${process.env.SITE_URL}/account.html`,
    });

    return res.status(200).json({ portalUrl: portalSession.url });
  } catch (err) {
    console.error("create-portal-session failed:", err.message);
    return res.status(500).json({ error: "Could not open subscription management — please try again." });
  }
}
