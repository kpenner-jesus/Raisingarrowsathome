-- ============================================================
--  20260529_audit3_fixes.sql — third-pass audit fixes (schema)
--
--  1. platform_tenant_stats: REVOKE EXECUTE FROM PUBLIC (the earlier
--     REVOKE FROM anon,authenticated was a no-op — the grant is to
--     PUBLIC). Anon could call /rest/v1/rpc/platform_tenant_stats and
--     read every tenant's aggregate stats. Also drop the dead 0-arg
--     overload (the (uuid) form with default null covers both call sites).
--  2. ensure_org_owner_after: short-circuit when the parent tenant is
--     gone, so a tenant DELETE (cascade → org_members) isn't blocked.
--  3. email_templates PK → (org_id, key) so each tenant has its own
--     copy of every template key.
--  4. email_optouts PK → (org_id, email) so an opt-out in one tenant
--     doesn't suppress another tenant's mail.
--  5. email_events.org_id → nullable so the Resend delivery webhook
--     (which has no reliable tenant context) can persist events.
--  6. Drop the leftover "profiles super write" FOR ALL policy missed by
--     20260527 (redundant with profiles_super_update; is_super_admin()
--     ≡ is_platform_super()).
-- ============================================================

-- 1. platform_tenant_stats — close the anon execute hole + drop dead overload.
revoke execute on function public.platform_tenant_stats(uuid) from public;
drop function if exists public.platform_tenant_stats();   -- 0-arg dead overload
grant execute on function public.platform_tenant_stats(uuid) to service_role;

-- 2. owner-required trigger: don't fire when the whole tenant is being deleted.
create or replace function public.ensure_org_owner_after() returns trigger
language plpgsql as $$
declare
  owners int;
  oid uuid;
begin
  oid := coalesce(new.org_id, old.org_id);
  -- If the parent tenant no longer exists, this is a tenant teardown
  -- (cascade delete) — let it through instead of blocking on "0 owners".
  if not exists (select 1 from public.tenants where id = oid) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext(oid::text));
  select count(*) into owners from public.org_members
   where org_id = oid and role = 'owner';
  if owners < 1 then
    raise exception 'org_members: at least one owner required per org (org_id %)', oid
      using errcode = '23514';
  end if;
  return null;
end $$;

-- 3. email_templates: per-tenant PK.
alter table public.email_templates drop constraint if exists email_templates_pkey;
alter table public.email_templates drop constraint if exists email_templates_org_key_uniq;
alter table public.email_templates add  constraint email_templates_pkey primary key (org_id, key);

-- 4. email_optouts: per-tenant PK.
alter table public.email_optouts drop constraint if exists email_optouts_pkey;
alter table public.email_optouts add  constraint email_optouts_pkey primary key (org_id, email);

-- 5. email_events.org_id nullable (Resend webhook best-effort resolution).
alter table public.email_events alter column org_id drop not null;

-- 6. Drop the leftover platform-super FOR ALL policy on profiles.
drop policy if exists "profiles super write" on public.profiles;
