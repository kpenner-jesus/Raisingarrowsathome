-- ============================================================
--  Staging bootstrap — runs every prod migration in order.
--  Paste this whole file into staging Supabase → SQL Editor → Run.
--  Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS guards.
-- ============================================================

-- === Migration 1: init_grant_portal ===
create extension if not exists "uuid-ossp";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'recipient' check (role in ('admin','recipient')),
  created_at timestamptz not null default now()
);

create table if not exists applications (
  id uuid primary key default uuid_generate_v4(),
  app_ref text unique not null,
  parent_names text not null,
  city text not null,
  contact_email text not null,
  contact_phone text not null,
  income_range text not null,
  current_schooling text not null,
  children jsonb not null,
  answers jsonb not null,
  video_link text,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  admin_notes text,
  decided_at timestamptz,
  decided_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists applications_status_idx on applications(status, created_at desc);

create table if not exists recipients (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references applications(id) on delete restrict,
  profile_id uuid references profiles(id) on delete set null,
  approved_amount numeric(10,2) not null,
  reimbursement_rate numeric(4,3) not null default 0.75,
  status text not null default 'active' check (status in ('active','completed','suspended')),
  created_at timestamptz not null default now()
);
create unique index if not exists recipients_app_idx on recipients(application_id);
create index if not exists recipients_profile_idx on recipients(profile_id);

create table if not exists receipts (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  image_path text not null,
  amount numeric(10,2) not null,
  purchase_date date,
  description text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_notes text,
  decided_at timestamptz,
  decided_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists receipts_rec_status_idx on receipts(recipient_id, status);

create table if not exists photos (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  image_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists testimonials (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists payout_batches (
  id uuid primary key default uuid_generate_v4(),
  scheduled_date date not null,
  status text not null default 'draft' check (status in ('draft','approved','exported','paid')),
  total numeric(10,2) not null default 0,
  ceo_reference text,
  exported_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists payouts (
  id uuid primary key default uuid_generate_v4(),
  batch_id uuid references payout_batches(id) on delete set null,
  recipient_id uuid not null references recipients(id) on delete cascade,
  amount numeric(10,2) not null,
  receipts_included jsonb not null default '[]'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled','approved','paid','cancelled')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payouts_batch_idx on payouts(batch_id);
create index if not exists payouts_rec_idx on payouts(recipient_id);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'role', 'recipient'))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table profiles         enable row level security;
alter table applications     enable row level security;
alter table recipients       enable row level security;
alter table receipts         enable row level security;
alter table photos           enable row level security;
alter table testimonials     enable row level security;
alter table payout_batches   enable row level security;
alter table payouts          enable row level security;

create or replace function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

drop policy if exists "profiles self"           on profiles;
drop policy if exists "profiles admin write"    on profiles;
drop policy if exists "applications admin"      on applications;
drop policy if exists "recipients admin"        on recipients;
drop policy if exists "recipients self"         on recipients;
drop policy if exists "receipts admin"          on receipts;
drop policy if exists "receipts self read"      on receipts;
drop policy if exists "receipts self insert"    on receipts;
drop policy if exists "photos admin"            on photos;
drop policy if exists "photos self read"        on photos;
drop policy if exists "photos self insert"      on photos;
drop policy if exists "testimonials admin"      on testimonials;
drop policy if exists "testimonials self read"  on testimonials;
drop policy if exists "testimonials self insert" on testimonials;
drop policy if exists "batches admin"           on payout_batches;
drop policy if exists "payouts admin"           on payouts;
drop policy if exists "payouts self"            on payouts;

create policy "profiles self"        on profiles      for select to authenticated using (id = auth.uid() or is_admin());
create policy "profiles admin write" on profiles      for all    to authenticated using (is_admin()) with check (is_admin());

create policy "applications admin"   on applications  for all    to authenticated using (is_admin()) with check (is_admin());

create policy "recipients admin"     on recipients    for all    to authenticated using (is_admin()) with check (is_admin());
create policy "recipients self"      on recipients    for select to authenticated using (profile_id = auth.uid());

create policy "receipts admin"       on receipts      for all    to authenticated using (is_admin()) with check (is_admin());
create policy "receipts self read"   on receipts      for select to authenticated using (recipient_id in (select id from recipients where profile_id = auth.uid()));
create policy "receipts self insert" on receipts      for insert to authenticated with check (recipient_id in (select id from recipients where profile_id = auth.uid()));

create policy "photos admin"         on photos        for all    to authenticated using (is_admin()) with check (is_admin());
create policy "photos self read"     on photos        for select to authenticated using (recipient_id in (select id from recipients where profile_id = auth.uid()));
create policy "photos self insert"   on photos        for insert to authenticated with check (recipient_id in (select id from recipients where profile_id = auth.uid()));

create policy "testimonials admin"       on testimonials for all    to authenticated using (is_admin()) with check (is_admin());
create policy "testimonials self read"   on testimonials for select to authenticated using (recipient_id in (select id from recipients where profile_id = auth.uid()));
create policy "testimonials self insert" on testimonials for insert to authenticated with check (recipient_id in (select id from recipients where profile_id = auth.uid()));

create policy "batches admin"        on payout_batches for all   to authenticated using (is_admin()) with check (is_admin());
create policy "payouts admin"        on payouts        for all   to authenticated using (is_admin()) with check (is_admin());
create policy "payouts self"         on payouts        for select to authenticated using (recipient_id in (select id from recipients where profile_id = auth.uid()));

insert into storage.buckets (id, name, public) values ('receipts','receipts',false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('photos','photos',false)     on conflict (id) do nothing;

drop policy if exists "receipts storage admin read"  on storage.objects;
drop policy if exists "receipts storage self read"   on storage.objects;
drop policy if exists "receipts storage self write"  on storage.objects;
drop policy if exists "photos storage admin read"    on storage.objects;
drop policy if exists "photos storage self read"     on storage.objects;
drop policy if exists "photos storage self write"    on storage.objects;

create policy "receipts storage admin read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and is_admin());
create policy "receipts storage self read"  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts storage self write" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos storage admin read"   on storage.objects for select to authenticated
  using (bucket_id = 'photos' and is_admin());
create policy "photos storage self read"    on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos storage self write"   on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- === Migration 2: api_tokens ===
create table if not exists api_tokens (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text not null,
  prefix text not null,
  token_hash text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists api_tokens_hash_idx on api_tokens(token_hash);
create index if not exists api_tokens_profile_idx on api_tokens(profile_id);
alter table api_tokens enable row level security;
drop policy if exists "api_tokens admin" on api_tokens;
create policy "api_tokens admin" on api_tokens for all to authenticated using (is_admin()) with check (is_admin());

-- === Migration 3: prevent_duplicate_draft_batches ===
create unique index if not exists payout_batches_scheduled_date_open_idx
  on payout_batches(scheduled_date)
  where status in ('draft', 'exported', 'approved');

-- === Migration 4: cra_compliance_and_grant_lifecycle ===
alter table recipients add column if not exists address_street text;
alter table recipients add column if not exists address_city text;
alter table recipients add column if not exists address_postal text;
alter table recipients add column if not exists submission_deadline date;
alter table recipients add column if not exists grandfathered boolean not null default false;
alter table receipts add column if not exists currency text not null default 'CAD';
alter table receipts drop constraint if exists receipts_currency_check;
alter table receipts add constraint receipts_currency_check check (currency in ('CAD', 'USD'));
alter table receipts add column if not exists reimbursable_amount numeric(10,2);
alter table payouts add column if not exists payment_method text;
alter table payouts add column if not exists payment_reference text;
alter table payouts add column if not exists recipient_acknowledged_at timestamptz;
alter table payout_batches add column if not exists bucket text;
create table if not exists audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  target_table text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_target_idx on audit_log(target_table, target_id, created_at desc);
create index if not exists audit_log_actor_idx on audit_log(actor_id, created_at desc);
alter table audit_log enable row level security;
drop policy if exists "audit_log admin" on audit_log;
create policy "audit_log admin" on audit_log for all to authenticated using (is_admin()) with check (is_admin());

-- === Migration 5: super_admin_role ===
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add  constraint profiles_role_check
  check (role in ('recipient', 'admin', 'super_admin'));

create or replace function is_super_admin() returns boolean language sql stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'super_admin')
$$;

create or replace function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'super_admin'))
$$;

drop policy if exists "profiles admin write" on profiles;
drop policy if exists "profiles super write" on profiles;
create policy "profiles super write" on profiles for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- === Migration 6: harden_role_helpers ===
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
$$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
$$;

-- === Migration 7: admin_panel_extensions ===
ALTER TABLE testimonials
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','hidden')),
  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE TABLE IF NOT EXISTS application_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_notes_app_idx ON application_notes(application_id, created_at DESC);
ALTER TABLE application_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "application_notes admin all" ON application_notes;
CREATE POLICY "application_notes admin all" ON application_notes FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_settings read" ON app_settings;
DROP POLICY IF EXISTS "app_settings admin write" ON app_settings;
CREATE POLICY "app_settings read" ON app_settings FOR SELECT USING (true);
CREATE POLICY "app_settings admin write" ON app_settings FOR ALL USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO app_settings (key, value) VALUES
  ('funding_caps',       '[{"label":"Ages 5-8","cap":375,"spend":500},{"label":"Ages 8-12","cap":500,"spend":667},{"label":"Ages 12-15","cap":650,"spend":867},{"label":"Ages 15-18","cap":750,"spend":1000}]'::jsonb),
  ('reimbursement_rate', '0.75'::jsonb),
  ('submission_deadline_months', '6'::jsonb),
  ('applications_open', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log admin read" ON audit_log;
CREATE POLICY "audit_log admin read" ON audit_log FOR SELECT USING (is_admin());

-- === Migration 8: admin_panel_phase2 ===
CREATE TABLE IF NOT EXISTS email_templates (
  key text PRIMARY KEY,
  label text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  vars text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_templates admin all" ON email_templates;
CREATE POLICY "email_templates admin all" ON email_templates FOR ALL USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO email_templates (key, label, subject, body_html, body_text, vars) VALUES
  ('application_approved', 'Application approved', 'Welcome to Raising Arrows — your grant is approved',
   '<p>Hi {{parent_names}},</p><p>Your application has been approved. Sign in to your portal to start submitting receipts.</p><p><a href="{{portal_url}}">Open my portal</a></p>',
   'Hi {{parent_names}},\nYour application has been approved. Open your portal: {{portal_url}}',
   ARRAY['parent_names','portal_url']),
  ('application_denied', 'Application denied', 'Update on your Raising Arrows application',
   '<p>Hi {{parent_names}},</p><p>Thank you for applying. We are not able to extend a grant at this time.</p><p>{{admin_notes}}</p>',
   'Hi {{parent_names}},\nThank you for applying. {{admin_notes}}',
   ARRAY['parent_names','admin_notes']),
  ('receipt_approved', 'Receipt approved', 'Your receipt for {{description}} was approved',
   '<p>Hi {{parent_names}},</p><p>Your {{amount}} receipt for {{description}} has been approved and added to your batch.</p>',
   'Hi {{parent_names}},\nYour ${{amount}} receipt was approved.',
   ARRAY['parent_names','amount','description','portal_url']),
  ('receipt_rejected', 'Receipt rejected', 'Your receipt for {{description}} was rejected',
   '<p>Hi {{parent_names}},</p><p>Your receipt for {{description}} was not approved.</p><p>{{admin_notes}}</p>',
   'Hi {{parent_names}},\nReceipt rejected. {{admin_notes}}',
   ARRAY['parent_names','description','admin_notes','portal_url']),
  ('batch_paid', 'Payout paid', 'Your reimbursement is on the way',
   '<p>Hi {{parent_names}},</p><p>Your batch totaling {{amount}} has been paid via e-transfer.</p>',
   'Hi {{parent_names}},\nYour payout of ${{amount}} is paid.',
   ARRAY['parent_names','amount','portal_url']),
  ('broadcast_default', 'Broadcast (custom)', '{{subject}}',
   '<p>Hi {{parent_names}},</p>{{body}}',
   'Hi {{parent_names}},\n{{body}}',
   ARRAY['parent_names','subject','body'])
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  audience text NOT NULL DEFAULT 'active_recipients'
    CHECK (audience IN ('active_recipients','all_recipients','admins')),
  recipient_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broadcasts admin all" ON broadcasts;
CREATE POLICY "broadcasts admin all" ON broadcasts FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE recipients ADD COLUMN IF NOT EXISTS cohort_year integer;
UPDATE recipients SET cohort_year = EXTRACT(YEAR FROM created_at)::integer WHERE cohort_year IS NULL;

-- === Migration 9: enrich_email_template_seeds — skipped, fresh seeds above are already enriched ===

-- === Migration 10: round_3_admin_ops ===
CREATE TABLE IF NOT EXISTS recipient_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recipient_notes_rec_idx ON recipient_notes(recipient_id, created_at DESC);
ALTER TABLE recipient_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipient_notes admin all" ON recipient_notes;
CREATE POLICY "recipient_notes admin all" ON recipient_notes FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE recipients
  ADD COLUMN IF NOT EXISTS archived_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS archived_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;
CREATE INDEX IF NOT EXISTS recipients_archived_idx ON recipients(archived_at);
CREATE INDEX IF NOT EXISTS applications_archived_idx ON applications(archived_at);

CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_id text,
  event_type text NOT NULL,
  recipient_email text,
  subject text,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_events_created_idx ON email_events(created_at DESC);
CREATE INDEX IF NOT EXISTS email_events_type_idx    ON email_events(event_type);
CREATE INDEX IF NOT EXISTS email_events_resend_idx  ON email_events(resend_id);
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_events admin read" ON email_events;
CREATE POLICY "email_events admin read" ON email_events FOR SELECT USING (is_admin());

-- === Migration 11: round_4_scheduling ===
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS state         text NOT NULL DEFAULT 'sent'
    CHECK (state IN ('queued','sending','sent','failed'));
UPDATE broadcasts SET sent_at = COALESCE(sent_at, created_at), state = 'sent' WHERE state IS NULL OR state = 'sent';
CREATE INDEX IF NOT EXISTS broadcasts_state_idx ON broadcasts(state, scheduled_for);
INSERT INTO app_settings (key, value) VALUES ('intake_status', '"open"'::jsonb) ON CONFLICT (key) DO NOTHING;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS waitlisted boolean NOT NULL DEFAULT false;

-- === Migration 12: round_5_features ===
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS duplicate_of_id uuid REFERENCES receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS receipts_dup_idx ON receipts(duplicate_of_id);

CREATE TABLE IF NOT EXISTS receipt_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE CHECK (length(trim(label)) > 0),
  sort_order int NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE receipt_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipt_categories read" ON receipt_categories;
DROP POLICY IF EXISTS "receipt_categories admin write" ON receipt_categories;
CREATE POLICY "receipt_categories read" ON receipt_categories FOR SELECT USING (true);
CREATE POLICY "receipt_categories admin write" ON receipt_categories FOR ALL USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO receipt_categories (label, sort_order) VALUES
  ('curriculum', 10), ('workbooks', 20), ('educational books', 30), ('readers', 40), ('other', 99)
ON CONFLICT (label) DO NOTHING;

CREATE TABLE IF NOT EXISTS email_optouts (
  email text PRIMARY KEY,
  scope text NOT NULL DEFAULT 'broadcasts' CHECK (scope IN ('broadcasts','all')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_optouts admin read" ON email_optouts;
CREATE POLICY "email_optouts admin read" ON email_optouts FOR SELECT USING (is_admin());

CREATE TABLE IF NOT EXISTS admin_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  token_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','super_admin')),
  invited_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_invites_email_idx ON admin_invites(email);
CREATE INDEX IF NOT EXISTS admin_invites_token_idx ON admin_invites(token_hash);
ALTER TABLE admin_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_invites super read" ON admin_invites;
CREATE POLICY "admin_invites super read" ON admin_invites FOR SELECT USING (is_super_admin());


-- ============================================================
--  PART 2 — Multi-tenant + audit migrations (20260525 → 20260530)
--  Appended so a fresh staging DB matches production exactly.
--  These were missing from the old bootstrap (which stopped at the
--  pre-multi-tenant schema: no tenants / org_members tables).
-- ============================================================


-- ###### 20260525_multi_tenant.sql ######
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


-- ###### 20260525_multi_tenant_rls.sql ######
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


-- ###### 20260526_audit_fixes.sql ######
-- ============================================================
--  20260526_audit_fixes.sql — multi-tenant SaaS audit follow-ups
--
--  1. tenants.last_reminder_kind + last_reminder_sent_at — billing-reminders idempotency
--  2. tenants.sender_domain UNIQUE — one tenant per Resend domain
--  3. stripe_events table — webhook idempotency
--  4. audit_log policy split — block admin DELETE/UPDATE of forensic trail
--  5. email_optouts INSERT policy — admin-only via RLS, service role bypass
--  6. platform_tenant_stats() RPC — exact aggregates for /platform dashboard
--  7. backfill correction — drop bogus 'recipient' memberships
-- ============================================================

-- 1. Billing-reminder idempotency state on tenants
alter table public.tenants
  add column if not exists last_reminder_kind    text,
  add column if not exists last_reminder_sent_at timestamptz;

comment on column public.tenants.last_reminder_kind    is 'Last platform-level reminder fired: trial_3day | trial_1day | past_due | null';
comment on column public.tenants.last_reminder_sent_at is 'Timestamp of the last platform reminder. Used to gate the weekly past_due nudge.';

create index if not exists tenants_last_reminder_kind_idx
  on public.tenants (last_reminder_kind);

-- 2. sender_domain uniqueness — multiple NULLs allowed via partial index
create unique index if not exists tenants_sender_domain_uniq
  on public.tenants (lower(sender_domain))
  where sender_domain is not null;

-- 3. Stripe webhook idempotency table
create table if not exists public.stripe_events (
  event_id    text primary key,
  event_type  text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- Only service role writes; no anon/authenticated access. No policies = closed.

-- 4. audit_log: SELECT + INSERT only — block admin DELETE/UPDATE
drop policy if exists audit_log_org_admin        on public.audit_log;
drop policy if exists audit_log_org_admin_select on public.audit_log;
drop policy if exists audit_log_org_admin_insert on public.audit_log;

create policy audit_log_org_admin_select on public.audit_log
  for select using (is_org_admin(org_id) or is_platform_super());

create policy audit_log_org_admin_insert on public.audit_log
  for insert with check (is_org_admin(org_id));
-- (no update / delete policy → blocked; service role still bypasses for ops cleanup)

-- 5. email_optouts: explicit INSERT policy so authenticated unsubscribe paths work
drop policy if exists email_optouts_insert_admin on public.email_optouts;
create policy email_optouts_insert_admin on public.email_optouts
  for insert with check (is_org_admin(org_id) or is_platform_super());

-- 6. Platform-wide stats RPC — single query, exact aggregates (no 1000-row cap)
create or replace function public.platform_tenant_stats()
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
  from public.tenants t;
$$;

-- Lock down RPC: only super_admin (via is_platform_super check inside) or service role.
revoke execute on function public.platform_tenant_stats() from anon, authenticated;
grant   execute on function public.platform_tenant_stats() to service_role;

-- 7. Backfill cleanup: phase-1 backfill inserted every profile as 'recipient'.
--    Drop the rows for profiles that don't have a matching recipients row.
delete from public.org_members om
where om.role = 'recipient'
  and not exists (
    select 1 from public.recipients r
    where r.profile_id = om.user_id
      and r.org_id     = om.org_id
  );


-- ###### 20260526_payout_batches_org_unique.sql ######
-- ============================================================
--  20260526_payout_batches_org_unique.sql
--
--  Replace the single-tenant unique index on payout_batches(scheduled_date)
--  with an org-scoped one. Without this two tenants could not have a draft
--  batch for the same date — the first generate would succeed, the second
--  would 23505 with "duplicate key".
-- ============================================================

drop index if exists public.payout_batches_scheduled_date_open_idx;

create unique index if not exists payout_batches_open_per_org_per_day_uniq
  on public.payout_batches (org_id, scheduled_date)
  where status in ('draft', 'exported', 'approved');


-- ###### 20260527_drop_legacy_is_admin_policies.sql ######
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


-- ###### 20260527_owner_check_and_stats_rpc.sql ######
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


-- ###### 20260527_stripe_events_processed_at.sql ######
-- ============================================================
--  20260527_stripe_events_processed_at.sql
--
--  Add processed_at column to stripe_events so the webhook handler
--  can do the side effect FIRST, then mark the event processed.
--  Retries on transient failure find the row with processed_at IS NULL
--  and re-run instead of bailing as "duplicate".
-- ============================================================

alter table public.stripe_events
  add column if not exists processed_at timestamptz;

create index if not exists stripe_events_unprocessed_idx
  on public.stripe_events (event_id)
  where processed_at is null;


-- ###### 20260528_apps_app_ref_org_unique.sql ######
-- ============================================================
--  20260528 — applications.app_ref → per-tenant uniqueness
--
--  Pre-multi-tenant the constraint was `app_ref text unique` (global).
--  Cross-tenant that's wrong: tenant B's bulk-import generator (or even
--  the submit flow's `RA-YYYYMMDD-NAME-RAND` pattern with a 4-hex
--  suffix) can collide on a string tenant A already used, producing a
--  user-facing duplicate-key error for an unrelated tenant's traffic.
--
--  Swap to (org_id, app_ref). Code already stamps org_id on every
--  applications insert; no `.eq("app_ref", …)` lookups exist anywhere
--  in the app (grepped), so the relaxation needs no call-site changes.
-- ============================================================

alter table public.applications
  drop constraint if exists applications_app_ref_key;

alter table public.applications
  add constraint applications_org_app_ref_key unique (org_id, app_ref);


-- ###### 20260529_audit3_fixes.sql ######
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


-- ###### 20260530_ai_chat_usage.sql ######
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

-- === Migration: 20260614_tenant_ai_settings — per-tenant OpenRouter config ===
alter table public.tenants
  add column if not exists openrouter_key_encrypted text,
  add column if not exists ai_model text;
revoke select (openrouter_key_encrypted) on public.tenants from anon, authenticated;

-- ============================================================
--  Done. Verify expected tables exist (should include tenants + org_members):
--    SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
-- ============================================================
