-- Aoibh funnel tracking: two new tables.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run twice (everything is "if not exists"). It does not touch any existing table.
--
-- Until this has been run, the site works exactly as before: every tracking write is
-- fail-soft (logged and skipped), so a missing table can never break a brief or a payment.

create table if not exists public.funnel_events (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  event        text not null,      -- view | section_view | cta_click | plan_click | brief_started | brief_saved | deposit_paid | balance_paid | subscribed
  page         text,               -- startups | agencies | home
  section      text,               -- for section_view: hero, problem, how, offer, work, proof, pricing, faq, final
  cta          text,               -- for cta_click / plan_click: which button
  device       text,               -- mobile | desktop (coarse, from screen width)
  env          text,               -- prod | preview (so test traffic can be hidden)
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,               -- the keyword (use {keyword} in Google Ads)
  utm_content  text,               -- the ad / creative
  gclid        text,               -- Google click id, kept for later offline-conversion import
  brief_id     uuid,               -- set for brief_saved / deposit_paid / balance_paid
  amount_cents integer             -- set for deposit_paid / balance_paid / subscribed
);

create index if not exists funnel_events_created_idx on public.funnel_events (created_at);
create index if not exists funnel_events_event_idx   on public.funnel_events (event);
create index if not exists funnel_events_brief_idx   on public.funnel_events (brief_id);

create table if not exists public.funnel_spend (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  week_start   date not null,      -- Monday of the week the spend belongs to
  campaign     text not null,      -- must match utm_campaign exactly
  amount_cents integer not null check (amount_cents >= 0),
  note         text
);

-- Row level security on, no public policies: only the server (service role) can read or write.
alter table public.funnel_events enable row level security;
alter table public.funnel_spend  enable row level security;

grant all on public.funnel_events to service_role;
grant all on public.funnel_spend  to service_role;
grant usage, select on all sequences in schema public to service_role;
