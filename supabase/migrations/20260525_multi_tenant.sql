-- ============================================================
--  Multi-tenant migration
--
--  Adds:
--   - public.tenants     : one row per charity using the platform
--   - public.org_members : link profiles ↔ tenants with per-tenant role
--   - org_id column on every tenant-scoped table
--
--  Backfills all existing data into the seeded 'raising-arrows' tenant
--  so the production deployment of raisingarrowsathome.com continues
--  to work without URL changes.
--
--  RLS policies are rewritten in a follow-up migration
--  (20260525_multi_tenant_rls.sql) so this file stays atomic per concern.
--
--  Run via:  supabase mcp apply_migration 20260525_multi_tenant
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. tenants table
-- ──────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id                       uuid primary key default gen_random_uuid(),
  -- URL-friendly identifier. Path routes use /o/<slug>/...
  slug                     text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name                     text not null,
  -- CRA registered charity number (BN format e.g. "803489451 RR0001"). Optional
  -- because some tenants may launch before incorporating.
  charity_number           text,
  -- Owner is the user who created/owns the org. Multiple admins can be in
  -- org_members but only one owner controls billing.
  owner_id                 uuid references public.profiles(id) on delete set null,
  -- Subscription state: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused'
  status                   text not null default 'trialing',
  -- Plan: 'free' | 'basic' (= $20/mo) | 'pro' | 'enterprise'
  plan                     text not null default 'basic',
  -- Stripe references
  stripe_customer_id       text,
  stripe_subscription_id   text,
  trial_ends_at            timestamptz,
  current_period_end       timestamptz,
  -- Branding
  brand_color              text default '#e8793a',
  logo_url                 text,
  -- Custom domain (optional, paid feature). When set, requests to this
  -- domain route to this tenant (verified via Cloudflare/Vercel domains).
  custom_domain            text unique,
  -- Custom sending domain (per Resend domain verification). When set +
  -- verified, outbound emails use sender_email; else fall back to platform.
  sender_email             text,                                   -- e.g. notifications@yourchurch.org
  sender_domain            text,                                   -- e.g. yourchurch.org
  sender_resend_domain_id  text,                                   -- Resend's domain ID for status polling
  sender_verified          boolean not null default false,
  created_at               timestamptz not null default now()
);

comment on table public.tenants is 'One row per charity using the platform. URL slug routes to here. Stripe billing per row.';

create index if not exists idx_tenants_owner_id     on public.tenants(owner_id);
create index if not exists idx_tenants_custom_domain on public.tenants(custom_domain) where custom_domain is not null;

-- ──────────────────────────────────────────────────────────
-- 2. org_members table
-- ──────────────────────────────────────────────────────────
create table if not exists public.org_members (
  org_id     uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  -- Per-tenant role. Independent of profiles.role (which is now platform-level
  -- only — used to grant access to the global /platform admin dashboard).
  role       text not null check (role in ('owner', 'admin', 'recipient')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

comment on table public.org_members is 'Links a user to a tenant with a per-tenant role. One user can belong to many tenants.';

create index if not exists idx_org_members_user_id on public.org_members(user_id);

-- ──────────────────────────────────────────────────────────
-- 3. Add org_id to every tenant-scoped table (nullable first
--    so we can backfill, then NOT NULL via 4-step process).
-- ──────────────────────────────────────────────────────────
alter table public.applications      add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.recipients        add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.receipts          add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.photos            add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.payouts           add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.payout_batches    add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.testimonials      add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.broadcasts        add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.email_templates   add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.app_settings      add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.audit_log         add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.email_events      add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.email_optouts     add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.api_tokens        add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.application_notes add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.recipient_notes   add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.admin_invites     add column if not exists org_id uuid references public.tenants(id) on delete cascade;
alter table public.receipt_categories add column if not exists org_id uuid references public.tenants(id) on delete cascade;

-- ──────────────────────────────────────────────────────────
-- 4. Seed the 'raising-arrows' tenant (idempotent insert).
--    Owner stays NULL until we link to a real profile in the
--    backfill step.
-- ──────────────────────────────────────────────────────────
insert into public.tenants (slug, name, status, plan, brand_color)
values ('raising-arrows', 'Raising Arrows', 'active', 'free', '#e8793a')
on conflict (slug) do nothing;

-- ──────────────────────────────────────────────────────────
-- 5. Backfill org_id on every existing row to the raising-arrows tenant
-- ──────────────────────────────────────────────────────────
do $$
declare
  ra_id uuid;
begin
  select id into ra_id from public.tenants where slug = 'raising-arrows';
  if ra_id is null then
    raise exception 'raising-arrows tenant not found — seed step failed';
  end if;

  update public.applications      set org_id = ra_id where org_id is null;
  update public.recipients        set org_id = ra_id where org_id is null;
  update public.receipts          set org_id = ra_id where org_id is null;
  update public.photos            set org_id = ra_id where org_id is null;
  update public.payouts           set org_id = ra_id where org_id is null;
  update public.payout_batches    set org_id = ra_id where org_id is null;
  update public.testimonials      set org_id = ra_id where org_id is null;
  update public.broadcasts        set org_id = ra_id where org_id is null;
  update public.email_templates   set org_id = ra_id where org_id is null;
  update public.app_settings      set org_id = ra_id where org_id is null;
  update public.audit_log         set org_id = ra_id where org_id is null;
  update public.email_events      set org_id = ra_id where org_id is null;
  update public.email_optouts     set org_id = ra_id where org_id is null;
  update public.api_tokens        set org_id = ra_id where org_id is null;
  update public.application_notes set org_id = ra_id where org_id is null;
  update public.recipient_notes   set org_id = ra_id where org_id is null;
  update public.admin_invites     set org_id = ra_id where org_id is null;
  update public.receipt_categories set org_id = ra_id where org_id is null;
end $$;

-- ──────────────────────────────────────────────────────────
-- 6. Backfill org_members from existing platform admin profiles
--    so existing admins keep the same access (now scoped to the
--    Raising Arrows org).
-- ──────────────────────────────────────────────────────────
insert into public.org_members (org_id, user_id, role)
select t.id, p.id,
       case
         when p.role = 'super_admin' then 'owner'
         when p.role = 'admin'       then 'admin'
         else                              'recipient'
       end
from public.profiles p
cross join public.tenants t
where t.slug = 'raising-arrows'
on conflict (org_id, user_id) do nothing;

-- Set the first super_admin as the official owner_id on the tenants row.
update public.tenants t
set owner_id = (
  select id from public.profiles where role = 'super_admin' order by created_at limit 1
)
where t.slug = 'raising-arrows' and t.owner_id is null;

-- ──────────────────────────────────────────────────────────
-- 7. Make org_id NOT NULL on every table now that backfill is done.
--    (Skips tables that may already be NOT NULL on a re-run.)
-- ──────────────────────────────────────────────────────────
alter table public.applications      alter column org_id set not null;
alter table public.recipients        alter column org_id set not null;
alter table public.receipts          alter column org_id set not null;
alter table public.photos            alter column org_id set not null;
alter table public.payouts           alter column org_id set not null;
alter table public.payout_batches    alter column org_id set not null;
alter table public.testimonials      alter column org_id set not null;
alter table public.broadcasts        alter column org_id set not null;
alter table public.email_templates   alter column org_id set not null;
alter table public.app_settings      alter column org_id set not null;
alter table public.audit_log         alter column org_id set not null;
alter table public.email_events      alter column org_id set not null;
alter table public.email_optouts     alter column org_id set not null;
alter table public.api_tokens        alter column org_id set not null;
alter table public.application_notes alter column org_id set not null;
alter table public.recipient_notes   alter column org_id set not null;
alter table public.admin_invites     alter column org_id set not null;
alter table public.receipt_categories alter column org_id set not null;

-- ──────────────────────────────────────────────────────────
-- 8. Indexes on org_id for every table (RLS filters scan these).
-- ──────────────────────────────────────────────────────────
create index if not exists idx_applications_org_id      on public.applications(org_id);
create index if not exists idx_recipients_org_id        on public.recipients(org_id);
create index if not exists idx_receipts_org_id          on public.receipts(org_id);
create index if not exists idx_photos_org_id            on public.photos(org_id);
create index if not exists idx_payouts_org_id           on public.payouts(org_id);
create index if not exists idx_payout_batches_org_id    on public.payout_batches(org_id);
create index if not exists idx_testimonials_org_id      on public.testimonials(org_id);
create index if not exists idx_broadcasts_org_id        on public.broadcasts(org_id);
create index if not exists idx_email_templates_org_id   on public.email_templates(org_id);
create index if not exists idx_app_settings_org_id      on public.app_settings(org_id);
create index if not exists idx_audit_log_org_id         on public.audit_log(org_id);
create index if not exists idx_email_events_org_id      on public.email_events(org_id);
create index if not exists idx_email_optouts_org_id     on public.email_optouts(org_id);
create index if not exists idx_api_tokens_org_id        on public.api_tokens(org_id);
create index if not exists idx_application_notes_org_id on public.application_notes(org_id);
create index if not exists idx_recipient_notes_org_id   on public.recipient_notes(org_id);
create index if not exists idx_admin_invites_org_id     on public.admin_invites(org_id);
create index if not exists idx_receipt_categories_org_id on public.receipt_categories(org_id);

-- ──────────────────────────────────────────────────────────
-- 9. app_settings: drop the global UNIQUE(key) and re-add as
--    UNIQUE(org_id, key) so each tenant has its own settings namespace.
-- ──────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema='public' and table_name='app_settings'
      and constraint_type='UNIQUE'
  ) then
    -- Drop the old single-column unique
    execute (
      select 'alter table public.app_settings drop constraint ' || quote_ident(constraint_name)
      from information_schema.table_constraints
      where table_schema='public' and table_name='app_settings' and constraint_type='UNIQUE'
      limit 1
    );
  end if;
end $$;

alter table public.app_settings add constraint app_settings_org_key_uniq unique (org_id, key);

-- Same for email_templates if it has a global unique on key
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema='public' and table_name='email_templates'
      and constraint_type='UNIQUE'
  ) then
    execute (
      select 'alter table public.email_templates drop constraint ' || quote_ident(constraint_name)
      from information_schema.table_constraints
      where table_schema='public' and table_name='email_templates' and constraint_type='UNIQUE'
      limit 1
    );
  end if;
end $$;

alter table public.email_templates add constraint email_templates_org_key_uniq unique (org_id, key);
