# Multi-tenant architecture

Quick reference for how a single Next.js + Supabase deployment serves N
independent charities. Updated 2026-05-26.

## Tenant resolution

Every request lands on one tenant via one of three paths:

1. **Custom domain** — `tenants.custom_domain = 'grants.cedarchurch.org'` (paid tier, future).
2. **Legacy hosts** — `raisingarrowsathome.com`, `www.`, `staging.`, `raising.wildernessedge.biz`, `raising-staging.wildernessedge.biz`, `localhost` → always `raising-arrows` tenant.
3. **Path-routed** — `/o/<slug>/...` → tenant with that slug. Middleware strips the prefix internally and sets `x-ra-org-slug` header.

Server components call `getOrgContext()` from `app/lib/org-context.ts`. The
helper reads the middleware-set header first, then falls back to host-based
resolution so /api routes on legacy hosts still resolve. The DB lookup is
deduped per request via `react.cache()`.

For pure routing logic (no React deps) import from `app/lib/org-routing.ts` —
safe for middleware + vitest.

## Data isolation

Every tenant-scoped table has `org_id uuid not null references tenants(id)
on delete cascade` + a btree index.

Tenant-scoped tables:

> applications, recipients, receipts, photos, payouts, payout_batches,
> testimonials, broadcasts, email_templates, app_settings, audit_log,
> email_events, email_optouts, api_tokens, application_notes,
> recipient_notes, admin_invites, receipt_categories

Not tenant-scoped: `profiles`, `tenants`, `org_members`, `stripe_events`.

### RLS

Three SECURITY DEFINER helpers in
`supabase/migrations/20260525_multi_tenant_rls.sql`:

- `is_org_member(uuid)` — caller is any role in this org.
- `is_org_admin(uuid)`  — caller is owner/admin in this org.
- `is_platform_super()` — caller's `profiles.role = 'super_admin'`.

Each tenant-scoped table has org-admin write + org-member read policies.
`audit_log` is SELECT + INSERT only (no admin DELETE/UPDATE).

### Service role

Server-side handlers usually call `supabaseService()` which bypasses RLS.
**Every such query must explicitly add `.eq("org_id", ctx.id)`**. The agent
+ pages refactored in commit `<TBD>` enforce this for every page + route.

## Cron multi-tenancy

`/api/cron/dispatch` fires daily at 12:00 UTC. It:

1. Always runs `sendDueBroadcasts` + `processBillingReminders`.
2. On day 1: monthly backup + summary-email mid.
3. On day 15: generate-payouts mid.
4. On day 17: summary-email end.
5. On day 28-last: generate-payouts end.

`/api/cron/generate-payouts` + `/api/cron/summary-email` iterate every tenant
where `status IN ('active','trialing','free')` via `listActiveTenants()` and
call the per-tenant lib functions `generatePayoutsForOrg` /
`sendSubmissionWindowSummaryForOrg`.

The unique index on `payout_batches` is `(org_id, scheduled_date) WHERE
status IN ('draft','exported','approved')` — so two tenants can have a
draft batch for the same day.

## Billing reminders

Daily idempotent state machine on `tenants.last_reminder_kind` +
`last_reminder_sent_at`. Decision logic is pure (`decideReminder` in
`app/lib/billing-reminder-logic.ts`) + unit-tested. State transitions:

- `null → trial_3day → trial_1day → (paid → null) | (past_due → past_due)`
- `past_due` re-fires once per 6+ days while status stays past_due.
- Stripe webhook clears `last_reminder_kind` when status flips off past_due
  so the cycle restarts on the next billing failure.

## Email sending

Per-tenant verified Resend domain support in `notify.ts`. `resolveFrom(orgId)`
returns `<tenant.name> <tenant.sender_email>` when `sender_verified = true`,
else falls back to `RESEND_FROM`. Platform emails (welcome, trial reminders,
past-due) always use `RESEND_FROM` via `notify-platform.ts`.

## Stripe webhook idempotency

`public.stripe_events (event_id PK)` deduplicates Stripe webhook delivery.
First receipt inserts; retries get `23505 unique_violation` → return early
with `{duplicate:true}` so Stripe stops retrying.

Webhook updates throw on Supabase error so Stripe gets a 5xx → automatic
retry. The stripe_events row persists so the retry dedups + we don't double
side-effect.

## Platform admin

`/platform` is gated by `profiles.role = 'super_admin'`. Lists all tenants
with exact aggregates from the `platform_tenant_stats()` Postgres RPC (no
1000-row PostgREST cap).

`/platform/tenants/[id]` drills into a single tenant. Pause/resume actions
flip `tenants.status` via `/api/platform/tenant-status`.

## Signup

`/signup` collects email → magic link → `/signup/new-org` wizard. Slug
availability is checked live via `/api/signup/check-slug?slug=` (350ms
debounce). On submit, `/api/signup/create-org`:

1. Upserts `profiles` with `ignoreDuplicates: true` so an existing
   super_admin's role isn't overwritten.
2. Inserts `tenants` row.
3. Inserts `org_members(role='owner')` — if this fails, rolls back the
   tenant insert so the slug isn't permanently burned.
4. Awaits welcome email (via `NEXT_PUBLIC_PLATFORM_URL` so the admin link
   in the email can't be host-header-injected).

## Required env vars

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Platform URL (trusted base used in all transactional emails)
NEXT_PUBLIC_PLATFORM_URL=https://raisingarrowsathome.com

# Resend
RESEND_API_KEY=
RESEND_FROM="Raising Arrows Platform <noreply@your-verified-domain>"

# Stripe (deferred — add when ready to charge)
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Cron
CRON_SECRET=

# Optional override for the bi-monthly summary recipient
SUMMARY_EMAIL_TO=
```

## Migrations applied (prod)

In order:

1. `001_init.sql`
2. `002_api_tokens.sql`
3. `20260525_multi_tenant.sql` — tenants + org_members + org_id columns + backfill
4. `20260525_multi_tenant_rls.sql` — RLS helpers + policies
5. `20260526_audit_fixes.sql` — last_reminder columns, stripe_events, audit_log split, platform_tenant_stats RPC, recipient backfill cleanup
6. `20260526_payout_batches_org_unique.sql` — replace single-tenant unique index

Staging Supabase needs the same migrations applied separately.
