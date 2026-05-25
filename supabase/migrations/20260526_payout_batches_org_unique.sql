-- ============================================================
--  20260526_payout_batches_org_unique.sql
--
--  Replace the single-tenant unique index on payout_batches(scheduled_date)
--  with an org-scoped one. Without this two tenants could not have a draft
--  batch for the same date — the first generate would succeed, the second
--  would 23505 with "duplicate key".
-- ============================================================

drop index if exists public.payout_batches_scheduled_date_open_idx;

create unique index if not exists payout_batches_open_per_org_per_day_uniq
  on public.payout_batches (org_id, scheduled_date)
  where status in ('draft', 'exported', 'approved');
