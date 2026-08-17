-- ============================================================
--  Three leftovers from the single-tenant era that break the SECOND charity.
--
--  1. app_settings still has PRIMARY KEY (key) — GLOBAL.
--     The multi-tenant migration meant to replace it, but its guard looked
--     for constraint_type='UNIQUE' and the constraint is a PRIMARY KEY, so
--     nothing was dropped. A UNIQUE(org_id, key) was layered on top and the
--     global key survived.
--
--     Consequence: the settings route upserts on (org_id, key). For a second
--     charity that pair does not conflict, so PostgREST issues a plain
--     INSERT, which violates app_settings_pkey. Every charity except the
--     first is permanently unable to save its funding caps, reimbursement
--     rate or intake status — and getSettings() quietly falls back to
--     DEFAULTS, so they silently run on the FIRST charity's funding numbers.
--
--  2. receipt_categories.label is UNIQUE platform-wide, never converted to
--     (org_id, label) the way app_ref, payout_batches and email_templates
--     were. The raising-arrows tenant already holds 'curriculum',
--     'workbooks', 'educational books', 'readers', 'other' — so a new
--     charity naming its categories the obvious things gets a raw duplicate
--     key error. The API even has a friendly per-org collision check with a
--     comment saying two orgs may share a label; the database disagreed.
--
--  3. receipts.category is READ by the reports page and the CRA receipts
--     export, and no SQL file in the repository ever created it. Asking
--     PostgREST for a column that doesn't exist fails the whole query, so
--     those two features return nothing today — the accountant's report
--     shows no receipt value at all.
--
--  Safe to re-run.
-- ============================================================

begin;

-- ── 1. app_settings: key is per-tenant, not global ──────────
alter table public.app_settings drop constraint if exists app_settings_pkey;
-- The (org_id, key) UNIQUE added by the multi-tenant migration is now
-- redundant with the primary key; drop it so we don't keep two identical
-- indexes on the same pair.
alter table public.app_settings drop constraint if exists app_settings_org_key_uniq;
alter table public.app_settings add primary key (org_id, key);

-- ── 2. receipt_categories: labels are per-tenant ────────────
alter table public.receipt_categories drop constraint if exists receipt_categories_label_key;
create unique index if not exists receipt_categories_org_label_uniq
  on public.receipt_categories (org_id, lower(label));

-- ── 3. receipts.category: the column the reports already read ──
alter table public.receipts add column if not exists category text;
comment on column public.receipts.category is
  'Free-text spend category, matched by label against this tenant''s receipt_categories. Read by the reports page and the CRA receipts export.';
create index if not exists idx_receipts_org_category
  on public.receipts (org_id, category) where category is not null;

commit;
