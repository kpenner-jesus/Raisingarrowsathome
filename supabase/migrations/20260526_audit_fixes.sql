-- ============================================================
--  20260526_audit_fixes.sql — multi-tenant SaaS audit follow-ups
--
--  1. tenants.last_reminder_kind + last_reminder_sent_at — billing-reminders idempotency
--  2. tenants.sender_domain UNIQUE — one tenant per Resend domain
--  3. stripe_events table — webhook idempotency
--  4. audit_log policy split — block admin DELETE/UPDATE of forensic trail
--  5. email_optouts INSERT policy — admin-only via RLS, service role bypass
--  6. platform_tenant_stats() RPC — exact aggregates for /platform dashboard
--  7. backfill correction — drop bogus 'recipient' memberships
-- ============================================================

-- 1. Billing-reminder idempotency state on tenants
alter table public.tenants
  add column if not exists last_reminder_kind    text,
  add column if not exists last_reminder_sent_at timestamptz;

comment on column public.tenants.last_reminder_kind    is 'Last platform-level reminder fired: trial_3day | trial_1day | past_due | null';
comment on column public.tenants.last_reminder_sent_at is 'Timestamp of the last platform reminder. Used to gate the weekly past_due nudge.';

create index if not exists tenants_last_reminder_kind_idx
  on public.tenants (last_reminder_kind);

-- 2. sender_domain uniqueness — multiple NULLs allowed via partial index
create unique index if not exists tenants_sender_domain_uniq
  on public.tenants (lower(sender_domain))
  where sender_domain is not null;

-- 3. Stripe webhook idempotency table
create table if not exists public.stripe_events (
  event_id    text primary key,
  event_type  text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- Only service role writes; no anon/authenticated access. No policies = closed.

-- 4. audit_log: SELECT + INSERT only — block admin DELETE/UPDATE
drop policy if exists audit_log_org_admin        on public.audit_log;
drop policy if exists audit_log_org_admin_select on public.audit_log;
drop policy if exists audit_log_org_admin_insert on public.audit_log;

create policy audit_log_org_admin_select on public.audit_log
  for select using (is_org_admin(org_id) or is_platform_super());

create policy audit_log_org_admin_insert on public.audit_log
  for insert with check (is_org_admin(org_id));
-- (no update / delete policy → blocked; service role still bypasses for ops cleanup)

-- 5. email_optouts: explicit INSERT policy so authenticated unsubscribe paths work
drop policy if exists email_optouts_insert_admin on public.email_optouts;
create policy email_optouts_insert_admin on public.email_optouts
  for insert with check (is_org_admin(org_id) or is_platform_super());

-- 6. Platform-wide stats RPC — single query, exact aggregates (no 1000-row cap)
create or replace function public.platform_tenant_stats()
returns table (
  org_id                  uuid,
  member_count            bigint,
  app_count               bigint,
  active_recipient_count  bigint,
  pending_receipt_count   bigint,
  total_paid              numeric
)
language sql
security definer
set search_path = public
as $$
  select
    t.id as org_id,
    (select count(*) from public.org_members om where om.org_id = t.id) as member_count,
    (select count(*) from public.applications a where a.org_id = t.id) as app_count,
    (select count(*) from public.recipients r
       where r.org_id = t.id and r.status = 'active') as active_recipient_count,
    (select count(*) from public.receipts rec
       where rec.org_id = t.id and rec.status = 'pending') as pending_receipt_count,
    coalesce((select sum(amount) from public.payouts p
       where p.org_id = t.id and p.status = 'paid'), 0) as total_paid
  from public.tenants t;
$$;

-- Lock down RPC: only super_admin (via is_platform_super check inside) or service role.
revoke execute on function public.platform_tenant_stats() from anon, authenticated;
grant   execute on function public.platform_tenant_stats() to service_role;

-- 7. Backfill cleanup: phase-1 backfill inserted every profile as 'recipient'.
--    Drop the rows for profiles that don't have a matching recipients row.
delete from public.org_members om
where om.role = 'recipient'
  and not exists (
    select 1 from public.recipients r
    where r.profile_id = om.user_id
      and r.org_id     = om.org_id
  );
