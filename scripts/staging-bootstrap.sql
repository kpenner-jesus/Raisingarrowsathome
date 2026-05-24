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
--  Done. Verify with: SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
-- ============================================================
