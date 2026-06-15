-- ============================================================
--  20260530_ai_chat_usage.sql — per-tenant daily message cap for
--  the in-app AI chat. Bounds platform LLM spend on $20/mo tenants.
-- ============================================================

create table if not exists public.ai_chat_usage (
  org_id        uuid not null references public.tenants(id) on delete cascade,
  day           date not null default (now() at time zone 'utc')::date,
  message_count int  not null default 0,
  primary key (org_id, day)
);

alter table public.ai_chat_usage enable row level security;
-- service-role only (no policies) — the chat routes use the service client.

-- Atomic consume: increments today's counter and reports whether the caller
-- is still within the cap. Race-safe via the single upsert (no read-then-write).
create or replace function public.ai_chat_consume(p_org_id uuid, p_cap int)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  cur int;
begin
  insert into public.ai_chat_usage (org_id, day, message_count)
  values (p_org_id, (now() at time zone 'utc')::date, 1)
  on conflict (org_id, day)
    do update set message_count = public.ai_chat_usage.message_count + 1
  returning message_count into cur;

  -- The attempt has already been counted; it's allowed only when the
  -- post-increment count is within the cap.
  return query select (cur <= p_cap), cur;
end $$;

-- Lock down execute. Supabase grants EXECUTE on public functions DIRECTLY to
-- anon + authenticated (Postgres default privileges), NOT only via PUBLIC — so
-- revoking from PUBLIC alone leaves those direct grants in place. Revoke all three.
revoke execute on function public.ai_chat_consume(uuid, int) from public, anon, authenticated;
grant  execute on function public.ai_chat_consume(uuid, int) to service_role;
