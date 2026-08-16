-- ============================================================
--  Email templates: archiving + the family welcome email.
--
--  1. archived_at — templates can now be retired without being
--     destroyed. Archiving must be reversible and must not lose the
--     copy someone wrote, so this is a nullable timestamp rather than
--     a delete. loadTemplate() ignores archived rows, so archiving a
--     key makes the sender fall back to its hardcoded copy instead of
--     sending nothing.
--
--  2. welcome_family — sent when a family is approved and gets portal
--     access. Until now that moment sent a bare Supabase sign-in link
--     plus the approval notice; nothing explained how the grant
--     actually works. Seeded for EVERY tenant, including the canonical
--     raising-arrows org that new tenants copy their templates from
--     (app/api/signup/create-org/route.ts) — without that row, every
--     future tenant would be missing it.
--
--  Safe to re-run: add column if not exists + on conflict do nothing.
-- ============================================================

alter table public.email_templates
  add column if not exists archived_at timestamptz;

comment on column public.email_templates.archived_at is
  'When set, the template is retired: hidden from the admin editor and ignored by loadTemplate(), which then falls back to the hardcoded copy. Null = active.';

create index if not exists idx_email_templates_active
  on public.email_templates (org_id, key) where archived_at is null;

-- NOTE: this migration originally also seeded a separate `welcome_family`
-- template. 20260616b folds that copy into `application_approved` and
-- archives it, because approval was sending two emails that asked for the
-- same next action. The seed is removed here so a fresh database never
-- creates a row that the very next migration retires.
