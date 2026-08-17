-- ============================================================
--  20260618_submit_throttle.sql — rate limiting for the PUBLIC
--  application funnel.
--
--  One row per identifier, REUSED across windows (the window is
--  rolled forward in place) so a busy source can't accumulate one
--  row per hour forever.
--
--  bucket_key is an HMAC, never a raw IP or email address: an IP is
--  personal information under PIPEDA and here it sits one join away
--  from a named family with children.
--
--  Safe to re-run.
-- ============================================================

create table if not exists public.submit_throttle (
  org_id        uuid not null references public.tenants(id) on delete cascade,
  scope         text not null,          -- 'ip_hour' | 'ip_day' | 'email_day' | 'org_day'
  bucket_key    text not null,          -- HMAC-SHA256 hex
  window_start  timestamptz not null default now(),
  hits          int  not null default 0,
  blocked_count int  not null default 0,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  primary key (org_id, scope, bucket_key)
);

create index if not exists submit_throttle_purge_idx   on public.submit_throttle (last_seen);
create index if not exists submit_throttle_org_win_idx on public.submit_throttle (org_id, window_start desc);

alter table public.submit_throttle enable row level security;

-- Read-only for the tenant's own admins + platform support. Every WRITE goes
-- through the service role via the function below.
drop policy if exists submit_throttle_org_admin on public.submit_throttle;
create policy submit_throttle_org_admin on public.submit_throttle
  for select using (is_org_admin(org_id) or is_platform_super());

-- ── Atomic multi-bucket consume ─────────────────────────────
--
-- Buckets are evaluated in ARRAY ORDER and the loop STOPS COUNTING after the
-- first denial. Without that, a flood aimed at one IP would also burn the
-- email bucket of whatever address it carried, locking the real owner of that
-- address out of the funnel for a day.
create or replace function public.application_submit_throttle(
  p_org_id  uuid,
  p_buckets jsonb   -- [{"scope":"ip_hour","key":"<hex>","limit":8,"window_s":3600}, ...]
)
returns table (out_scope text, hits int, lim int, allowed boolean, retry_after_s int, evaluated boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  b jsonb;
  v_scope text; v_key text; v_limit int; v_window int;
  v_hits int; v_start timestamptz;
  denied boolean := false;
begin
  for b in select * from jsonb_array_elements(p_buckets) loop
    v_scope  := b->>'scope';
    v_key    := b->>'key';
    v_limit  := (b->>'limit')::int;
    v_window := (b->>'window_s')::int;

    if denied then
      out_scope := v_scope; hits := null; lim := v_limit;
      allowed := false; retry_after_s := null; evaluated := false;
      return next;
      continue;
    end if;

    -- Race-safe: one INSERT .. ON CONFLICT DO UPDATE takes the row lock and
    -- re-evaluates the SET expressions against the committed row, so there is
    -- no read-then-write for concurrent lambdas to interleave. The CASE rolls
    -- an expired window forward instead of inserting a new row.
    insert into public.submit_throttle as t
      (org_id, scope, bucket_key, window_start, hits, blocked_count)
    values (p_org_id, v_scope, v_key, now(), 1, 0)
    on conflict (org_id, scope, bucket_key) do update
      set hits = case when t.window_start <= now() - make_interval(secs => v_window)
                      then 1 else t.hits + 1 end,
          blocked_count = case when t.window_start <= now() - make_interval(secs => v_window)
                      then 0 else t.blocked_count end,
          window_start = case when t.window_start <= now() - make_interval(secs => v_window)
                      then now() else t.window_start end,
          last_seen = now()
    returning t.hits, t.window_start into v_hits, v_start;

    -- The attempt has already been counted; it is allowed only when the
    -- post-increment count is within the limit.
    allowed := (v_hits <= v_limit);

    if not allowed then
      denied := true;
      update public.submit_throttle s
         set blocked_count = s.blocked_count + 1
       where s.org_id = p_org_id and s.scope = v_scope and s.bucket_key = v_key;
    end if;

    out_scope := v_scope; hits := v_hits; lim := v_limit; evaluated := true;
    retry_after_s := case when allowed then null else
      greatest(1, ceil(extract(epoch from
        (v_start + make_interval(secs => v_window)) - now()))::int) end;
    return next;
  end loop;
end $$;

-- Lock down execute. Supabase grants EXECUTE on public functions DIRECTLY to
-- anon + authenticated (Postgres default privileges), NOT only via PUBLIC — so
-- revoking from PUBLIC alone leaves those direct grants in place. Revoke all three.
revoke execute on function public.application_submit_throttle(uuid, jsonb)
  from public, anon, authenticated;
grant  execute on function public.application_submit_throttle(uuid, jsonb)
  to service_role;
