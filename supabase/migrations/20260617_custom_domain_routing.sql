-- ============================================================
--  Make tenants.custom_domain safe to route on.
--
--  The column has existed since the multi-tenant migration and is documented
--  as "when set, requests to this domain route to this tenant" — but nothing
--  ever read it for routing and nothing ever wrote it. Now that
--  getOrgContext() looks tenants up by Host, the stored value has to be
--  CANONICAL, because the lookup is a plain equality match:
--
--      bare lowercase hostname, no scheme, no port, no path, no trailing dot
--
--  A value like "https://Grants.CedarChurch.org/" would simply never match
--  any Host header, and would fail silently — the charity's domain would
--  appear configured and behave as though it weren't.
--
--  Backfill is expected to touch ZERO rows (no code has ever written this
--  column); it exists so a hand-entered value can't poison routing.
--
--  Safe to re-run.
-- ============================================================

begin;

update public.tenants
   set custom_domain = lower(btrim(custom_domain))
 where custom_domain is not null
   and custom_domain <> lower(btrim(custom_domain));

-- Trailing FQDN dot: browsers don't send one, curl and some proxies do.
update public.tenants
   set custom_domain = rtrim(custom_domain, '.')
 where custom_domain like '%.';

alter table public.tenants
  drop constraint if exists tenants_custom_domain_canonical;

alter table public.tenants
  add constraint tenants_custom_domain_canonical check (
    custom_domain is null
    or (
      custom_domain = lower(custom_domain)
      and custom_domain !~ '[[:space:]]'
      and custom_domain !~ '[:/?#@]'            -- no scheme, port, path or query
      and custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      and length(custom_domain) between 4 and 253
      and custom_domain not like '%.vercel.app' -- platform-owned, never a tenant's
    )
  ) not valid;

-- NOT VALID then VALIDATE keeps the exclusive lock window short: the validate
-- pass takes only a SHARE UPDATE EXCLUSIVE lock, so reads and writes continue.
alter table public.tenants validate constraint tenants_custom_domain_canonical;

-- The column already carries a plain UNIQUE. Case-insensitivity is now
-- structural (the CHECK forces lowercase), but keep a functional unique index
-- as belt and braces — mirrors how sender_domain was done in 20260526.
create unique index if not exists tenants_custom_domain_lower_uniq
  on public.tenants (lower(custom_domain))
  where custom_domain is not null;

comment on column public.tenants.custom_domain is
  'Bare lowercase hostname (no scheme/port/path). When set AND attached to the hosting project, a request with this Host resolves to this tenant via getOrgContext(). Setting this alone is NOT enough: the domain must also be attached in the hosting dashboard, DNS pointed, and the domain added to the Supabase Auth redirect allowlist — without that last step every magic link on the domain fails silently.';

commit;
