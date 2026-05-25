-- ============================================================
--  Multi-tenant RLS rewrite
--
--  Replaces the previous is_admin()-based policies with org-scoped
--  variants. Three new SECURITY DEFINER helpers do the work:
--
--    is_org_member(org_uuid)  → caller belongs to that org (any role)
--    is_org_admin(org_uuid)   → caller is owner OR admin in that org
--    is_platform_super()      → caller is profiles.role='super_admin'
--                                (for the global /platform dashboard)
--
--  is_admin() / is_super_admin() are KEPT so existing code paths don't
--  break during the rollout — but they now answer:
--    is_admin()       = "is owner/admin in ANY org" (still useful for
--                       legacy code paths that don't yet pass an org_id)
--    is_super_admin() = profiles.role='super_admin' (platform-level)
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. Helpers
-- ──────────────────────────────────────────────────────────
create or replace function public.is_org_member(org_uuid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.org_members
    where org_id = org_uuid and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(org_uuid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.org_members
    where org_id = org_uuid and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_platform_super()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

-- Replace legacy is_admin() to mean "owner/admin in ANY org" so existing
-- queries (e.g. middleware role checks) continue to behave sensibly.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.org_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  ) or exists(
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

-- ──────────────────────────────────────────────────────────
-- 2. Enable RLS + policies on the new tables
-- ──────────────────────────────────────────────────────────
alter table public.tenants     enable row level security;
alter table public.org_members enable row level security;

drop policy if exists tenants_member_read     on public.tenants;
drop policy if exists tenants_super_write     on public.tenants;
drop policy if exists tenants_owner_write     on public.tenants;
drop policy if exists org_members_self_read   on public.org_members;
drop policy if exists org_members_admin_write on public.org_members;

-- A user can read every tenant they belong to + platform super sees all.
create policy tenants_member_read on public.tenants
  for select using (is_org_member(id) or is_platform_super());

-- Only the org owner can write tenant-level config (branding, billing, domain).
create policy tenants_owner_write on public.tenants
  for update using (
    exists(select 1 from public.org_members
           where org_id = tenants.id and user_id = auth.uid() and role = 'owner')
    or is_platform_super()
  );

-- Platform super can insert/delete tenants (e.g. for support);
-- normal signup uses the service role.
create policy tenants_super_write on public.tenants
  for all using (is_platform_super())
  with check (is_platform_super());

-- Org members: each member sees their own memberships; org admins see all
-- memberships within their org.
create policy org_members_self_read on public.org_members
  for select using (
    user_id = auth.uid()
    or is_org_admin(org_id)
    or is_platform_super()
  );

create policy org_members_admin_write on public.org_members
  for all using (
    is_org_admin(org_id) or is_platform_super()
  )
  with check (
    is_org_admin(org_id) or is_platform_super()
  );

-- ──────────────────────────────────────────────────────────
-- 3. Rewrite policies on every tenant-scoped table:
--    drop the legacy is_admin() policy → add an is_org_admin(org_id) one.
--    Existing "self" policies are kept (they already filter by recipient
--    ownership; org_id is implicit because the user only belongs to orgs
--    that contain their own recipient row).
-- ──────────────────────────────────────────────────────────

-- applications
drop policy if exists "applications admin"     on public.applications;
drop policy if exists applications_org_admin   on public.applications;
create policy applications_org_admin on public.applications
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- recipients
drop policy if exists "recipients admin"  on public.recipients;
drop policy if exists "recipients self"   on public.recipients;
drop policy if exists recipients_org_admin on public.recipients;
drop policy if exists recipients_self     on public.recipients;
create policy recipients_org_admin on public.recipients
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy recipients_self on public.recipients
  for select using (profile_id = auth.uid());

-- receipts
drop policy if exists "receipts admin"        on public.receipts;
drop policy if exists "receipts self read"    on public.receipts;
drop policy if exists "receipts self insert"  on public.receipts;
drop policy if exists receipts_org_admin      on public.receipts;
drop policy if exists receipts_self_read      on public.receipts;
drop policy if exists receipts_self_insert    on public.receipts;
create policy receipts_org_admin on public.receipts
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy receipts_self_read on public.receipts
  for select using (
    recipient_id in (select id from public.recipients where profile_id = auth.uid())
  );
create policy receipts_self_insert on public.receipts
  for insert with check (
    recipient_id in (select id from public.recipients where profile_id = auth.uid())
  );

-- photos
drop policy if exists "photos admin"        on public.photos;
drop policy if exists "photos self read"    on public.photos;
drop policy if exists "photos self insert"  on public.photos;
drop policy if exists photos_org_admin      on public.photos;
drop policy if exists photos_self_read      on public.photos;
drop policy if exists photos_self_insert    on public.photos;
create policy photos_org_admin on public.photos
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy photos_self_read on public.photos
  for select using (
    recipient_id in (select id from public.recipients where profile_id = auth.uid())
  );
create policy photos_self_insert on public.photos
  for insert with check (
    recipient_id in (select id from public.recipients where profile_id = auth.uid())
  );

-- payouts
drop policy if exists "payouts admin" on public.payouts;
drop policy if exists "payouts self"  on public.payouts;
drop policy if exists payouts_org_admin on public.payouts;
drop policy if exists payouts_self      on public.payouts;
create policy payouts_org_admin on public.payouts
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy payouts_self on public.payouts
  for select using (
    recipient_id in (select id from public.recipients where profile_id = auth.uid())
  );

-- payout_batches
drop policy if exists "batches admin"        on public.payout_batches;
drop policy if exists payout_batches_org_admin on public.payout_batches;
create policy payout_batches_org_admin on public.payout_batches
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- testimonials
drop policy if exists "testimonials admin"        on public.testimonials;
drop policy if exists "testimonials self read"    on public.testimonials;
drop policy if exists "testimonials self insert"  on public.testimonials;
drop policy if exists testimonials_org_admin      on public.testimonials;
drop policy if exists testimonials_self_read      on public.testimonials;
drop policy if exists testimonials_self_insert    on public.testimonials;
create policy testimonials_org_admin on public.testimonials
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy testimonials_self_read on public.testimonials
  for select using (
    recipient_id in (select id from public.recipients where profile_id = auth.uid())
  );
create policy testimonials_self_insert on public.testimonials
  for insert with check (
    recipient_id in (select id from public.recipients where profile_id = auth.uid())
  );

-- broadcasts (admin-only resource)
drop policy if exists "broadcasts admin all" on public.broadcasts;
drop policy if exists broadcasts_org_admin   on public.broadcasts;
create policy broadcasts_org_admin on public.broadcasts
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- email_templates: admins manage; anyone in the org can read (sending paths
-- may need read access to render templates server-side).
drop policy if exists "email_templates admin all" on public.email_templates;
drop policy if exists email_templates_org_admin   on public.email_templates;
drop policy if exists email_templates_member_read on public.email_templates;
create policy email_templates_org_admin on public.email_templates
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy email_templates_member_read on public.email_templates
  for select using (is_org_member(org_id));

-- app_settings
drop policy if exists "app_settings admin write" on public.app_settings;
drop policy if exists "app_settings read"        on public.app_settings;
drop policy if exists app_settings_org_admin     on public.app_settings;
drop policy if exists app_settings_member_read   on public.app_settings;
create policy app_settings_org_admin on public.app_settings
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy app_settings_member_read on public.app_settings
  for select using (is_org_member(org_id));

-- audit_log
drop policy if exists "audit_log admin"      on public.audit_log;
drop policy if exists "audit_log admin read" on public.audit_log;
drop policy if exists audit_log_org_admin    on public.audit_log;
create policy audit_log_org_admin on public.audit_log
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- email_events
drop policy if exists "email_events admin read" on public.email_events;
drop policy if exists email_events_org_admin    on public.email_events;
create policy email_events_org_admin on public.email_events
  for select using (is_org_admin(org_id));

-- email_optouts
drop policy if exists "email_optouts admin read" on public.email_optouts;
drop policy if exists email_optouts_org_admin    on public.email_optouts;
create policy email_optouts_org_admin on public.email_optouts
  for select using (is_org_admin(org_id));

-- api_tokens
drop policy if exists "api_tokens admin"    on public.api_tokens;
drop policy if exists api_tokens_org_admin  on public.api_tokens;
create policy api_tokens_org_admin on public.api_tokens
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- application_notes
drop policy if exists "application_notes admin all" on public.application_notes;
drop policy if exists application_notes_org_admin   on public.application_notes;
create policy application_notes_org_admin on public.application_notes
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- recipient_notes
drop policy if exists "recipient_notes admin all" on public.recipient_notes;
drop policy if exists recipient_notes_org_admin   on public.recipient_notes;
create policy recipient_notes_org_admin on public.recipient_notes
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- admin_invites
drop policy if exists "admin_invites super read" on public.admin_invites;
drop policy if exists admin_invites_org_admin    on public.admin_invites;
create policy admin_invites_org_admin on public.admin_invites
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- receipt_categories: members read, admins write
drop policy if exists "receipt_categories admin write" on public.receipt_categories;
drop policy if exists "receipt_categories read"        on public.receipt_categories;
drop policy if exists receipt_categories_org_admin     on public.receipt_categories;
drop policy if exists receipt_categories_member_read   on public.receipt_categories;
create policy receipt_categories_org_admin on public.receipt_categories
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy receipt_categories_member_read on public.receipt_categories
  for select using (is_org_member(org_id));
