-- ============================================================
--  SECURITY (critical): signup could self-assign platform super_admin.
--
--  handle_new_user() runs on every auth.users insert and did this:
--
--      coalesce(new.raw_user_meta_data->>'role', 'recipient')
--
--  raw_user_meta_data is CLIENT-SUPPLIED. Signup is open and uses the public
--  anon key, so anyone could call the auth endpoint directly with
--
--      options: { data: { role: 'super_admin' } }
--
--  and the trigger would write that straight into profiles.role.
--
--  profiles.role = 'super_admin' is the ONLY gate on the platform console and
--  on is_platform_super() in RLS, which grants: write/delete ANY tenant
--  (cascading away its applications, recipients, receipts and payouts), insert
--  yourself as owner of any charity, rewrite anyone's role, and read every
--  family's receipt and photo files across every charity.
--
--  The database already blocked escalation AFTER account creation —
--  profiles_self_update pins role to its previous value. This was the one door
--  left open, and it was at the moment of account creation.
--
--  The role is now hardcoded. Every legitimate path that needs a different one
--  sets it explicitly server-side afterwards (admin invites, the platform
--  console), none of which rely on this trigger.
--
--  Safe to re-run.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- NEVER read the role from raw_user_meta_data: that is attacker-controlled
  -- input on an open signup endpoint.
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'recipient')
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profiles row for a new auth user. The role is ALWAYS recipient: raw_user_meta_data is client-supplied, and reading a role from it allowed self-assignment of platform super_admin. Elevate deliberately via the admin invite flow or the platform console.';
