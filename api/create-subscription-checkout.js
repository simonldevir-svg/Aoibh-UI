// api/create-subscription-checkout.js
//
// Creates a Stripe Checkout session to start a new Starter/Growth
// subscription. Pay-first: unlike the trial project (where a brief
// already exists and this is called against it), no brief and no
// subscriber row exist yet at this point — the subscriber row is only
// created once api/stripe-webhook.js confirms payment actually cleared.
//
// Env vars needed: STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER,
// STRIPE_PRICE_GROWTH, SITE_URL.

import Stripe from 'stripe';
import { cleanAttribution, cleanPage } from './_funnel.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TIER_PRICES = {
  starter: process.env.STRIPE_PRICE_STARTER,
  growth: process.env.STRIPE_PRICE_GROWTH,
};

// The site advertises these prices in pounds (index.html, lp/*.html). Before charging, check that
// the configured Stripe Price really is that amount in GBP, so a stale or euro Price ID can never
// charge a customer something different from what the page promised. Checked once per cold start.
const ADVERTISED = { starter: { currency: 'gbp', cents: 99500 }, growth: { currency: 'gbp', cents: 279500 } };
const priceChecked = {};
async function assertPriceMatchesAdvert(tier) {
  if (priceChecked[tier]) return;
  const price = await stripe.prices.retrieve(TIER_PRICES[tier]);
  const want = ADVERTISED[tier];
  if (price.currency !== want.currency || price.unit_amount !== want.cents) {
    console.error(`STRIPE_PRICE_${tier.toUpperCase()} is ${price.unit_amount} ${price.currency}, but the site advertises ${want.cents} ${want.currency}`);
    const err = new Error('This plan is being updated and cannot be bought online right now. Please contact us at hello@aoibh.ai.');
    err.status = 503;
    throw err;
  }
  priceChecked[tier] = true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, tier } = req.body || {};
    const cleanEmail = (email || '').trim();

    if (!cleanEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!TIER_PRICES[tier]) {
      return res.status(400).json({ error: 'tier must be starter or growth' });
    }
    if (!TIER_PRICES[tier].startsWith('price_')) {
      return res.status(500).json({ error: `STRIPE_PRICE_${tier.toUpperCase()} is not configured` });
    }

    await assertPriceMatchesAdvert(tier);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: cleanEmail,
      line_items: [{ price: TIER_PRICES[tier], quantity: 1 }],
      // Campaign tags ride along on the session so the webhook can credit the subscription to the ad
      metadata: {
        tier,
        ...Object.fromEntries(Object.entries(cleanAttribution(req.body && req.body.attribution)).filter(([, v]) => v)),
        ...(req.body && req.body.attribution && req.body.attribution.lp ? { lp: cleanPage(req.body.attribution.lp) } : {}),
      },
      success_url: `${process.env.SITE_URL}/subscriber-login.html?subscribed=1`,
      cancel_url: `${process.env.SITE_URL}/#pricing`,
    });

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('create-subscription-checkout error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Could not create checkout session' });
  }
}
