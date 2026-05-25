-- ============================================================
--  20260527_owner_check_and_stats_rpc.sql
--
--  1. org_members deferrable constraint trigger — at-least-one-
--     owner enforced at the DB layer so concurrent role changes
--     can't both pass the application-level count check.
--
--  2. platform_tenant_stats(p_org_id uuid default null) — adds an
--     optional org_id filter so /platform/tenants/[id] can fetch
--     ONE tenant's stats without scanning every other tenant.
-- ============================================================

create or replace function public.ensure_org_owner_after() returns trigger
language plpgsql as $$
declare
  owners int;
  oid uuid;
begin
  oid := coalesce(new.org_id, old.org_id);
  perform pg_advisory_xact_lock(hashtext(oid::text));
  select count(*) into owners from public.org_members
   where org_id = oid and role = 'owner';
  if owners < 1 then
    raise exception 'org_members: at least one owner required per org (org_id %)', oid
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists org_members_owner_required on public.org_members;
create constraint trigger org_members_owner_required
  after update or delete on public.org_members
  deferrable initially deferred
  for each row execute function public.ensure_org_owner_after();

create or replace function public.platform_tenant_stats(p_org_id uuid default null)
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
  from public.tenants t
  where p_org_id is null or t.id = p_org_id;
$$;

revoke execute on function public.platform_tenant_stats(uuid) from anon, authenticated;
grant   execute on function public.platform_tenant_stats(uuid) to service_role;
