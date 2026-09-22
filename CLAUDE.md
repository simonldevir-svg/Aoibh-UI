# Aoibh

Aoibh is an AI + human creative production studio. This is the real,
deployed codebase — GitHub `simonldevir-svg/Aoibh-UI`, deployed as the
Vercel project `aoibh-ui`. It replaces an earlier local copy (`Aoibh 2.0/`) that
fell behind once payments and persistence were built directly against
this repo instead. See `Research/backend-architecture-proposal.md` section
0 for the full reconciliation between what was originally planned and
what's actually here.

## Folder structure

- `index.html` — the marketing/intake site: hero, feed, process, stats,
  gallery, network, capabilities, pricing, cta. The brief flow lives here;
  on match it now redirects to `dashboard.html?id=<briefId>` rather than
  opening an in-page Studio section.
- `dashboard.html` — the real, persisted client dashboard. Reads a brief by
  `?id=<uuid>&email=<email>` via `api/dashboard-data.js` (email must match
  the brief's stored email — no login, but no longer just a bare uuid
  either). Renders deposit/in-progress/delivered states off
  `payment_status`. The pipeline status card is a placeholder — no live
  8-stage tracking wired yet.
- `login.html` — staff sign-in: enter your email, get a magic link.
  Wired to the header's "Sign in" link on `index.html`.
- `staff.html` — post-login hub, links to the tools below. Redirects to
  `login.html` if there's no valid session.
- `upload.html` — internal-only page for uploading deliverables against a
  brief (`api/upload-deliverable.js`). Session-gated (redirects to
  `login.html` if not signed in) — no more shared admin secret.
- `qa-review.html` — internal-only page listing AI-flagged uploads for a
  human decision (`api/qa-review.js`). Same session gate as `upload.html`.
- `subscriber-login.html` — sign-in for Starter/Growth subscribers: enter
  your email, get a magic link. Separate from staff `login.html` — a
  subscriber token and a staff token are never interchangeable.
- `account.html` — a subscriber's post-login hub: plan, renewal date (or
  a past-due/canceled notice), usage ("X of N used this period"), a
  working "Start a new project" link, and a placeholder "Manage
  subscription" button (not wired up yet — see Subscriptions below).
  Redirects to `subscriber-login.html` if there's no valid session.
- `new-project.html` — session-gated form (project/deadline/assets) a
  subscriber uses to start a project under their plan. Posts to
  `api/match-designer.js`, which checks their session cookie directly —
  see Subscriptions below.
- `maintenance.html` — static page served by `middleware.js` when
  `site_settings.mode = 'maintenance'`.
- `styles.css` — shared site CSS.
- `journal/` — the Journal (blog), separate indexable HTML pages, not an
  index.html section. `journal/index.html` is the listing page. New
  articles: create the file, add its card to `journal/index.html`'s grid,
  add its URL to `sitemap.xml`.
- `sitemap.xml`, `robots.txt` — reference `https://aoibh.ai/`.
- `middleware.js` — Vercel Edge Middleware, runs on every request except
  `/api/`, `/assets/`, and `maintenance.html` itself. Checks
  `api/site-mode.js` for the current mode and gates/redirects accordingly.
- `api/` — Vercel serverless functions:
  - `phrase-questions.js` — `POST /api/phrase-questions`
  - `match-designer.js` — `POST /api/match-designer` — also saves every
    completed brief to Supabase's `briefs` table and emails a lead
    notification via Resend
  - `dashboard-data.js` — `GET /api/dashboard-data?id=<briefId>&email=<email>`
    — requires `email` to match the brief's stored email (interim check,
    not real auth)
  - `create-checkout.js` — `POST /api/create-checkout` — Stripe Checkout
    session for the deposit or balance stage
  - `create-subscription-checkout.js` — `POST /api/create-subscription-checkout`
    — body `{email, tier}`, `tier` is `starter`|`growth`. Stripe Checkout
    session in `mode:'subscription'` for the pricing page's "Get started"
    buttons. Pay-first — no subscriber row exists until the webhook
    confirms payment (see below); this only creates the Checkout session.
  - `stripe-webhook.js` — `POST /api/stripe-webhook` — reconciles
    `checkout.session.completed` against `briefs.payment_status` (trial
    project, `mode:'payment'`) and against the new `subscribers` table
    (`mode:'subscription'` — creates the row, emails a welcome/sign-in
    message). Also handles `customer.subscription.updated`/`.deleted` to
    keep a subscriber's `status`/`current_period_start`/`current_period_end`
    in sync on renewal, plan change, or cancellation. Emails the client
    when the trial deposit clears.
  - `upload-deliverable.js` — `POST /api/upload-deliverable` — requires
    `x-admin-secret` matching `SITE_MODE_ADMIN_SECRET`. Also emails the
    client on the first preview of a review round (not every preview —
    one "it's ready" per round, not one per image)
  - `mark-delivered.js` — `POST /api/mark-delivered` — same
    `x-admin-secret` gate. Sets `briefs.status = 'delivered'` (requires at
    least one `deliverables` row to already exist) and emails the client.
    Replaces hand-editing status in Supabase's table editor — triggered
    from the "Mark as delivered" button in `upload.html`
  - `contact.js` — `POST /api/contact` — writes to `contacts`, emails via
    Resend
  - `site-mode.js` — `GET/POST /api/site-mode` — reads/writes
    `site_settings`; POST requires `x-admin-secret` matching
    `SITE_MODE_ADMIN_SECRET`
  - `job-status.js` — `GET /api/job-status?jobNumber=<n>&email=<email>` —
    powers the triage flow's "check an existing job" branch
  - `qa-review.js` — `GET/POST /api/qa-review` — staff-session gated. GET
    lists flagged `qa_checks`; POST records a human decision
    (`approved_by_human` | `sent_back`). Backs `qa-review.html`
  - `auth-request.js` — `POST /api/auth-request` — body `{email}`. If it
    matches `STAFF_ADMIN_EMAIL`, emails a single-use magic sign-in link
    (15-min expiry) via Resend. Always responds the same either way, so it
    can't be used to probe valid emails.
  - `auth-verify.js` — `GET /api/auth-verify?token=<token>` — the link
    from that email. Verifies the token, creates a 30-day session, sets
    the `aoibh_staff_session` cookie, redirects to `staff.html`.
  - `auth-session.js` — `GET /api/auth-session` — `{authenticated, email?}`
    for the current cookie. Called by `staff.html`/`upload.html`/
    `qa-review.html` on load to gate rendering.
  - `auth-logout.js` — `POST /api/auth-logout` — deletes the session row,
    clears the cookie.
  - `subscriber-auth-request.js` / `subscriber-auth-verify.js` /
    `subscriber-auth-session.js` / `subscriber-auth-logout.js` — same
    magic-link pattern as the staff auth files above, but checks the
    `subscribers` table instead of a single hardcoded email, and reads/
    writes `subscriber_magic_links`/`subscriber_sessions` (the
    `aoibh_subscriber_session` cookie) instead of the staff tables.
    `auth-session.js`'s response also carries `tier`/`status`/
    `currentPeriodEnd`/`projectsUsed`/`projectsCap` (via a PostgREST
    embed on `subscribers` plus a computed count of that period's
    `briefs`), which `account.html` renders.
  - `create-portal-session.js` — `POST /api/create-portal-session` —
    same cookie auth as the subscriber-auth files. Looks up the
    subscriber's `stripe_customer_id` and creates a real Stripe Customer
    Portal session, returning `{portalUrl}`. Backs `account.html`'s
    "Manage subscription" button. Requires the Customer Portal to be
    turned on in the Stripe dashboard (Settings → Billing → Customer
    portal) — this endpoint just creates a session against whatever's
    configured there, it doesn't configure it.
- `Research/` — competitive research, notes, and the backend architecture
  proposal (now annotated with what's actually built vs. still planned).
- `Moodboards/` — visual inspiration (currently empty).

## Environment variables

Required (all set in Vercel already): `ANTHROPIC_API_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`,
`SITE_MODE_ADMIN_SECRET`, `STAFF_ADMIN_EMAIL` (the one email allowed to
request a staff sign-in link — see Staff auth below), `STRIPE_PRICE_STARTER`,
`STRIPE_PRICE_GROWTH` (Stripe recurring Price IDs for the two self-serve
subscription tiers — see Subscriptions below). Not yet present in a local
`.env.local` for this folder — needed before running anything locally
against real data.

## Staff auth

`upload.html` and `qa-review.html` are gated by a real magic-link login
(`login.html` → `auth-request.js` → email → `auth-verify.js` → session
cookie), not the old shared `SITE_MODE_ADMIN_SECRET`. Single admin only
for now (`STAFF_ADMIN_EMAIL`) — no per-designer accounts yet; see Open
items. `api/site-mode.js`'s POST still uses `x-admin-secret` since it has
no HTML page of its own (called directly when needed) — deliberately not
migrated, nothing to gain from it yet.

## Subscriptions (2026-09-18, in progress)

Starter/Growth are real Stripe subscriptions now, pay-first: the pricing
section's "Get started" buttons (`index.html`, `.pricing-cta[data-tier]`)
open a small email-capture modal (`#subscribeOverlay`), which calls
`api/create-subscription-checkout.js` and redirects to Stripe. No
`subscribers` row exists until `api/stripe-webhook.js` confirms payment
via `checkout.session.completed` (`mode:'subscription'`) — see its header
comment for the full event list. New tables: `subscribers`
(`stripe_customer_id`, `stripe_subscription_id`, `tier`, `status`,
`current_period_start/end`), plus `subscriber_magic_links` /
`subscriber_sessions` mirroring the staff-auth tables exactly, but kept
separate on purpose (a staff token should never double as a subscriber
token). Enterprise stays "Talk to us" — no self-serve checkout for it.

Subscriber login + account hub (`subscriber-login.html`, `account.html`)
are built — see the `subscriber-auth-*.js` files above.

"Start a new project" is live: `account.html` links to `new-project.html`
(session-gated, 3 fields — project/deadline/assets, no name/email/triage/
budget since those exist for cold leads, not paying subscribers) which
POSTs to `api/match-designer.js`. That handler now checks for a
`aoibh_subscriber_session` cookie before anything else — if present, it
looks up the subscriber (never trusting `email` from the request body,
only the verified session), blocks with a clear error if `status` isn't
`active` or if they've hit their plan's per-billing-period cap (Starter
1, Growth 3 — `TIER_PROJECT_CAPS`, checked via a computed count of
`briefs.subscriber_id` rows since `current_period_start`, same
"computed, not a stored counter" approach as everywhere else), and
otherwise saves the brief with `subscriber_id` set and
`payment_status: 'covered_by_subscription'` — skipping the deposit/
balance flow entirely. Since there's no deposit-confirmed webhook moment
to notify the client from, `saveBrief()` sends a "Your project is
underway" email directly for these. `account.html` and
`subscriber-auth-session.js` also surface "X of N used this period",
computed the same way.

`dashboard.html` and `api/match-designer.js`'s `saveBrief()` treat
`payment_status = 'covered_by_subscription'` as "already paid, no
balance owed" — the deposit screen never shows, and the in-progress
preview state shows "Included in your plan" instead of a "Pay balance"
button. `api/dashboard-data.js` needed no changes — it already passes
`payment_status` through untouched.

"Manage subscription" now opens a real Stripe Customer Portal session
(`api/create-portal-session.js`) — self-serve cancel/plan-change/card
update, all handled by Stripe's own hosted UI, not custom-built here.
`api/stripe-webhook.js`'s `handleSubscriptionUpdated`/`handleSubscriptionDeleted`
already covered keeping `status`/period dates in sync for whatever a
subscriber does there — nothing new needed on that side.

All six build phases are done. Remaining: switching `STRIPE_SECRET_KEY`/
`STRIPE_WEBHOOK_SECRET` to live values once Stripe approves the account
for live payments (their review, not build time) — see
`Research/pricing-tier-decisions.md` for the pricing reasoning, unrelated
to this technical step.

## Database (Supabase)

Four tables live in production, all simpler than the schema
`Research/backend-architecture-proposal.md` sections 1–2 originally
proposed — see section 0 there for the full comparison:

- `briefs` — one row per completed brief. Answers, AI match result, and
  the full Stripe payment state (`payment_status`, `deposit_amount`,
  `balance_amount`, `stripe_deposit_session_id`,
  `stripe_balance_session_id`, `deposit_paid_at`, `balance_paid_at`) all
  live on this one table — no separate `clients`/`projects` split. Also
  `subscriber_id` (nullable, FK to `subscribers`) — set when a project
  was started from a subscriber's account instead of the trial flow;
  those rows get `payment_status = 'covered_by_subscription'` instead of
  the usual pending/deposit_paid/paid_in_full progression.
- `contacts` — footer contact-form submissions. `id`, `created_at`,
  `query`, `email` only.
- `deliverables` — file pointers (`brief_id`, `file_name`, `file_url`),
  written by `upload-deliverable.js`.
- `site_settings` — single-row site mode config. Fixed 2026-09-04 (was
  missing a `GRANT` for `service_role`, which made every mode-switch read
  silently fail open to `"live"`).
- `designers` — one row per designer/art director (`role` column
  distinguishes them). Replaces the hardcoded `ROSTER` array that used to
  be duplicated across `match-designer.js`, `dashboard-data.js`, and
  `stripe-webhook.js` — those files now fetch from this table (falling
  back to a small hardcoded list if Supabase is unreachable). Editing a
  designer is a Table Editor row edit now, not a code change.
- `qa_checks` — one row per AI quality check on an uploaded image
  (`kind`: `preview` | `deliverable`). Written by `upload-deliverable.js`
  whenever an image file is uploaded; reviewed via `qa-review.html` /
  `api/qa-review.js`.
- `magic_links` — single-use staff sign-in tokens (`token`, `email`,
  `expires_at`, `used_at`). Written by `auth-request.js`, consumed by
  `auth-verify.js`.
- `staff_sessions` — active staff logins (`token`, `email`, `expires_at`).
  Created by `auth-verify.js`; checked on every request to `upload.html`'s
  and `qa-review.html`'s API endpoints; deleted on sign-out.

## How the intake flow works

1. Visitor opens the brief modal → Aoibh asks for their **name**, then
   **email** (validated client-side).
2. **Triage question** (hardcoded on the frontend): *"Is this your first
   enquiry, or do you have a job number for a progress report?"*
   - **3+ digits detected** → hands off to a human producer, no further
     questions.
   - **No digits** → proceeds to step 3.
3. `phrase-questions.js` warmly rephrases the fixed 4-question set
   (project, budget, deadline, assets). Falls back to static copy on
   failure — never blocks the flow.
   - **Budget gate**: under €1,000 → hands off to a human producer.
4. All 4 answered → `match-designer.js` picks a designer from `ROSTER`,
   scores confidence, **saves the brief to Supabase**, emails a lead
   notification. On failure, a deterministic `fallbackMatch()` covers it.
   - **80% confidence threshold** — below it, hands off to a human
     producer.
5. On match, the frontend redirects to `dashboard.html?id=<briefId>` — a
   real page reading real data, not an in-memory view.
6. From the dashboard, "pay deposit" / "pay balance" calls
   `create-checkout.js` → Stripe Checkout → `stripe-webhook.js` updates
   `payment_status` on completion.

Both AI endpoints use `model: "claude-sonnet-5"`, an 8s timeout, and
"fail soft" behavior — never 500 the client just because Claude or the
network misbehaves. Keep that convention in any new endpoint.

## Open items

See `Research/backend-architecture-proposal.md` section 0 for the full,
current reconciliation of what's built vs. planned. Sections 1–10 of that
document remain the best reference for what *isn't* built yet: formal
8-stage pipeline tracking, dashboard chat, per-designer staff accounts,
client auth, and marketing consent capture.

Staff auth (2026-09-18) is admin-only by design — a single allowlisted
email (`STAFF_ADMIN_EMAIL`), magic link, no passwords. Designers don't
log in themselves yet; the admin still uploads/reviews on their behalf.
Extending this to per-designer logins (each seeing only their own
projects) would mean adding real emails to the `designers` table and
checking assignment, not just identity, on each request — deliberately
deferred until it's actually needed.

AI QA (2026-09-17) is a lighter version of the original design: it
compares an uploaded image against the brief's original text answers,
not structured `brand_specs` (never built — no client ever provides
approved colors/fonts today). The flagged-issues review page
(`qa-review.html`) is a deliberate stand-in for the real staff dashboard,
which doesn't exist yet — same `x-admin-secret` gate as everything else
until real staff auth is built.

`terms.html`, `privacy.html` — working drafts, both carry a visible
"not yet reviewed by a lawyer" notice and bracketed placeholders. Fill
those in and get real legal review before removing the draft notice.
