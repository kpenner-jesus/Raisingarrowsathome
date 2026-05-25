-- ============================================================
--  20260527_drop_legacy_is_admin_policies.sql
--
--  Drop policies that still gate on bare is_admin(). After
--  20260525_multi_tenant_rls.sql, is_admin() means "owner/admin in
--  ANY org" — which silently grants cross-tenant access via every
--  legacy policy referencing it.
--
--  Affected: profiles + storage.objects (receipts + photos buckets).
-- ============================================================

drop policy if exists "profiles self"        on public.profiles;
drop policy if exists "profiles admin write" on public.profiles;
drop policy if exists profiles_self_read     on public.profiles;
drop policy if exists profiles_super_read    on public.profiles;
drop policy if exists profiles_self_update   on public.profiles;
drop policy if exists profiles_super_update  on public.profiles;

create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or is_platform_super());

create policy profiles_super_update on public.profiles
  for update using (is_platform_super()) with check (is_platform_super());

create policy profiles_self_update on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

drop policy if exists "receipts storage admin read" on storage.objects;
drop policy if exists "photos storage admin read"   on storage.objects;
drop policy if exists "receipts storage super read" on storage.objects;
drop policy if exists "photos storage super read"   on storage.objects;

create policy "receipts storage super read" on storage.objects
  for select using (bucket_id = 'receipts' and is_platform_super());

create policy "photos storage super read" on storage.objects
  for select using (bucket_id = 'photos' and is_platform_super());
