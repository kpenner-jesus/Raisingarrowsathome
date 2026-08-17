-- ============================================================
--  Make broadcasts resumable.
--
--  A broadcast sends to every family one at a time inside a single
--  invocation and writes results only at the end. Killed halfway: the row is
--  stranded in state='sending', some families received it and some didn't,
--  nothing retries (the cron only looks for state='queued'), and pressing
--  Send again re-mails everyone.
--
--  The fix is a per-recipient ledger. It also solves a second problem: the
--  recipient query has no ORDER BY and doesn't select a stable key, so row
--  order isn't guaranteed and membership drifts between invocations — a
--  naive offset cursor would skip or repeat families. Freezing the audience
--  into a table at claim time makes "who still needs this" a query rather
--  than a re-derivation, and matches what the send form promises the
--  operator ("send to 47 active recipients").
--
--  NOTE: the broadcasts.state CHECK is deliberately NOT changed. It is a
--  closed set, and code writing a new value against a database that hasn't
--  had this migration applied would throw. Every extra state the UI needs is
--  DERIVED: "preparing" = sending + materialized_at is null; "stalled" =
--  sending + stale progress_at; "incomplete" = sent + rows still pending.
--
--  Safe to re-run.
-- ============================================================

create table if not exists public.broadcast_sends (
  id           uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  org_id       uuid not null references public.tenants(id)    on delete cascade,
  -- ALWAYS stored trimmed + lowercased, so the unique index below is a plain
  -- two-column index. PostgREST's on_conflict takes column names, not
  -- expressions, so a lower(email) index could not be used for upserts.
  email        text not null,
  parent_names text,
  status       text not null default 'pending'
                 check (status in ('pending', 'sent', 'failed')),
  attempts     int  not null default 0,
  provider_id  text,
  last_error   text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- The heart of it: one row per recipient per broadcast, ever.
create unique index if not exists broadcast_sends_uniq
  on public.broadcast_sends (broadcast_id, email);
-- Drives "give me the next chunk to send".
create index if not exists broadcast_sends_pending_idx
  on public.broadcast_sends (broadcast_id, status, id);
create index if not exists broadcast_sends_org_idx
  on public.broadcast_sends (org_id);

alter table public.broadcast_sends enable row level security;
drop policy if exists broadcast_sends_org_admin on public.broadcast_sends;
-- Read-only for tenant admins; all writes go through the service role, the
-- same shape used for stripe_events.
create policy broadcast_sends_org_admin on public.broadcast_sends
  for select using (is_org_admin(org_id) or is_platform_super());

alter table public.broadcasts
  -- Set only after the audience is FULLY written. Until then a half-written
  -- ledger is indistinguishable from "fully written, half sent", which would
  -- silently under-send and then report success.
  add column if not exists materialized_at  timestamptz,
  add column if not exists progress_at      timestamptz,
  -- Fencing token. Every write-back carries it, so a worker whose lease
  -- expired cannot stomp the counters of whoever took over.
  add column if not exists lease_owner      uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists total_count      integer;

comment on column public.broadcasts.total_count is
  'Frozen audience size, set at materialization. NULL on broadcasts sent before the ledger existed — that is how the UI knows not to show a denominator or offer Resume for them.';

comment on column public.broadcasts.lease_owner is
  'Fencing token held by whichever worker is currently sending. Writes to this row must match it, so a stalled worker cannot clobber a newer one.';

create index if not exists broadcasts_resume_idx
  on public.broadcasts (state, lease_expires_at) where state = 'sending';

-- Deliberately NO backfill of progress_at/materialized_at on existing rows.
-- A pre-ledger broadcast has no record of who already received it, so making
-- it eligible for automatic resume would mean re-mailing everyone.
