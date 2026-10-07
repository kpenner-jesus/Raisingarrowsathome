-- ============================================================
--  20261007_lock_privileged_writes.sql
--
--  Closes three ways a signed-in user could go around the app by
--  calling the database API directly with their own login (the anon
--  key is public, and their session token is theirs):
--
--  1. tenants_owner_write let an org OWNER update ANY column of their
--     tenant row. Every self-serve signup is an owner, so anyone could
--     set status='active', clear trial_ends_at, or flip
--     sender_verified=true — free service forever, or "verified" mail
--     from a domain nobody verified. A trigger now limits non-staff
--     updates to the cosmetic columns the product actually lets owners
--     edit. All app writes use the service role and are unaffected.
--
--  2. org_members_admin_write let any ADMIN rewrite membership rows,
--     including promoting themselves to owner. The app's own Team
--     screen is owner-only; the database now agrees.
--
--  3. audit_log_org_admin_insert let an admin insert entries naming
--     any actor. The audit trail is only worth anything if a row's
--     actor is the person who wrote it.
--
--  Also sets size and type limits on the two storage buckets, which
--  had none (the 8 MB cap existed only in the browser).
--
--  Safe to re-run.
-- ============================================================

-- ── 1. Tenant row: owners may edit branding fields only ─────────────
create or replace function public.guard_tenant_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The only columns an owner edits through the product (branding).
  owner_editable constant text[] := array['name', 'charity_number', 'brand_color', 'logo_url'];
begin
  -- Server code (service_role) and direct SQL are trusted; platform staff
  -- may change anything. Only end-user sessions are restricted.
  if current_user not in ('authenticated', 'anon') or public.is_platform_super() then
    return new;
  end if;

  if (to_jsonb(new) - owner_editable) is distinct from (to_jsonb(old) - owner_editable) then
    raise exception 'only branding fields can be changed on a tenant'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists tenants_guard_privileged_columns on public.tenants;
create trigger tenants_guard_privileged_columns
  before update on public.tenants
  for each row execute function public.guard_tenant_privileged_columns();

-- ── 2. Membership: owners (or platform staff) only ──────────────────
create or replace function public.is_org_owner(org_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.org_members
    where org_id = org_uuid and user_id = auth.uid() and role = 'owner'
  );
$$;

drop policy if exists org_members_admin_write on public.org_members;
drop policy if exists org_members_owner_write on public.org_members;
create policy org_members_owner_write on public.org_members
  for all
  using      (public.is_org_owner(org_id) or public.is_platform_super())
  with check (public.is_org_owner(org_id) or public.is_platform_super());

-- ── 3. Audit rows must name their real author ───────────────────────
drop policy if exists audit_log_org_admin_insert on public.audit_log;
create policy audit_log_org_admin_insert on public.audit_log
  for insert
  with check (public.is_org_admin(org_id) and actor_id = auth.uid());

-- ── 4. Storage limits ───────────────────────────────────────────────
update storage.buckets
   set file_size_limit = 10485760,                        -- 10 MB
       allowed_mime_types = array['image/*', 'application/pdf']
 where id = 'receipts';

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/*']
 where id = 'photos';
