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
