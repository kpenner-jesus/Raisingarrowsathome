-- ============================================================
--  20260527_stripe_events_processed_at.sql
--
--  Add processed_at column to stripe_events so the webhook handler
--  can do the side effect FIRST, then mark the event processed.
--  Retries on transient failure find the row with processed_at IS NULL
--  and re-run instead of bailing as "duplicate".
-- ============================================================

alter table public.stripe_events
  add column if not exists processed_at timestamptz;

create index if not exists stripe_events_unprocessed_idx
  on public.stripe_events (event_id)
  where processed_at is null;
