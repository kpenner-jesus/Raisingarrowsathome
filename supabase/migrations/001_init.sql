-- ============================================================
-- Raising Arrows grant portal — initial schema
-- Run this once against a fresh Supabase project.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── PROFILES (linked to auth.users) ──────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'recipient' check (role in ('admin','recipient')),
  created_at timestamptz not null default now()
);

-- ── APPLICATIONS (funnel submissions) ────────────────────────
create table applications (
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
create index on applications(status, created_at desc);

-- ── RECIPIENTS (approved applicants) ─────────────────────────
create table recipients (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references applications(id) on delete restrict,
  profile_id uuid references profiles(id) on delete set null,
  approved_amount numeric(10,2) not null,
  reimbursement_rate numeric(4,3) not null default 0.75,
  status text not null default 'active' check (status in ('active','completed','suspended')),
  created_at timestamptz not null default now()
);
create unique index on recipients(application_id);
create index on recipients(profile_id);

-- ── RECEIPTS ─────────────────────────────────────────────────
create table receipts (
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
create index on receipts(recipient_id, status);

-- ── PHOTOS ───────────────────────────────────────────────────
create table photos (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  image_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

-- ── TESTIMONIALS ─────────────────────────────────────────────
create table testimonials (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ── PAYOUT BATCHES (handoff to CEO Ministries) ───────────────
create table payout_batches (
  id uuid primary key default uuid_generate_v4(),
  scheduled_date date not null,
  status text not null default 'draft' check (status in ('draft','approved','exported','paid')),
  total numeric(10,2) not null default 0,
  ceo_reference text,
  exported_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default uuid_generate_v4(),
  batch_id uuid references payout_batches(id) on delete set null,
  recipient_id uuid not null references recipients(id) on delete cascade,
  amount numeric(10,2) not null,
  receipts_included jsonb not null default '[]'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled','approved','paid','cancelled')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index on payouts(batch_id);
create index on payouts(recipient_id);

-- ── AUTO-PROVISION PROFILE ON SIGNUP ─────────────────────────
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

-- ── ROW-LEVEL SECURITY ───────────────────────────────────────
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

-- ── STORAGE BUCKETS ──────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('receipts','receipts',false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('photos','photos',false)     on conflict (id) do nothing;

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
