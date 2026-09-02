# Raising Arrows — hand-off

Written 2026-09-02 for the next model or engineer picking this up cold.
Everything here was verified against the running system, not recalled.

Read the **Traps** section before you change anything. Most of it exists
because something in it already cost real money or real data.

---

## 1. What this is

A multi-tenant SaaS for charities that give **homeschool grants to families**.
The flagship tenant is Raising Arrows, run by CEO Ministries.

The money flow, which is the spine of the whole product:

```
family applies  →  admin approves  →  family becomes a RECIPIENT
     ↓                                          ↓
 application                            uploads RECEIPTS
                                                ↓
                                  admin approves receipts
                                                ↓
                                    PAYOUT (e-transfer)
```

A family has a funding **cap** and a **reimbursement rate** (e.g. 75%). They
buy curriculum, upload the receipt, and get reimbursed up to the cap.

**The people**

| Who | Role |
|---|---|
| **Kevin Penner** (`info@wildernessedge.com`) | The person you talk to. Owns the platform. Not the day-to-day charity admin. |
| **Tierza Hammond** (`tierzahammond@gmail.com`) | Runs Raising Arrows. Owner + platform super_admin. Non-technical. |
| `register@raisingarrowsathome.com` | The charity's shared mailbox. Also an admin account. |

Kevin's standing instruction: **plain English, minimal jargon.** He is not an
engineer. Explain what things do in ordinary words. Tierza gets grade-5
English — Kevin often asks for a message he can text her directly.

---

## 2. The stack

- **Next.js 14.2.29**, App Router, TypeScript. React 18.
- **Supabase** — Postgres + Auth (magic links) + Storage.
- **Vercel** hosting. Hobby tier: **60s function ceiling regardless of
  `maxDuration`**, ~4.5MB request/response cap, **one daily cron**.
- **Resend** for email. **Stripe** for subscriptions (not configured yet).
- **Vitest** — 428 passing, pure-logic only, no DB.

61 API route files, 22 migrations, 25 test files.

---

## 3. The two environments — read this twice

**There is ONE Vercel project serving BOTH sites.**

| | Live | Practice |
|---|---|---|
| URL | `raisingarrowsathome.com` | `staging.raisingarrowsathome.com` |
| Git branch | `main` | `staging` |
| `VERCEL_ENV` | `production` | `preview` |
| Supabase project | `otwrxfjytbhzdkwiebeu` | `hobwdalfmnukyxhebtkz` |

**Staging's database is a CLONE of production.** It contains real families'
names, addresses and email addresses. Treat it as sensitive. This is why:

- Outbound email on staging is **redirected to whoever is signed in**, never to
  the address on the record (`app/lib/email-env.ts` → `routeRecipients`).
  With nobody signed in it falls back to `STAGING_EMAIL_REDIRECT_TO`, and with
  that unset it sends **nothing** — the safe failure, not a misconfiguration.
- Staging admits **admins only**. A non-admin has their session torn down at
  `app/auth/callback`.

Both sites share **one Resend account**, and Resend's webhook can only be
registered at one URL — production's. See Traps.

---

## 4. Deploying

Migrations are applied **by hand**. There is no migration runner in CI.

### Normal order — code tolerates a missing table

1. `git push origin HEAD:staging` → verify on staging
2. Apply the migration to staging, verify
3. `git push origin HEAD:main`
4. Apply the migration to production

Most code here degrades deliberately: a missing table logs a warning and takes
a safe path (see `hasLedger()` in `broadcasts.ts`, `hasThrottleTable()` in
`submit-throttle.ts`). Both cache only the POSITIVE result and re-probe every
30s, so a warm lambda starts working the moment a migration lands, with no
redeploy.

### REVERSED order — when a route names new columns explicitly

If an insert or select **names** a new column, the code fails the instant it
deploys without it. Then the migration goes **first, on both**, before the
code. `20260619_application_mailing_address` was one of these: shipping code
first would have made every live application fail to save.

### The push command

Windows Credential Manager serves a `WildernessEdge` account with **no write
access**. A plain `git push` returns 403. Use:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin HEAD:staging
```

Then **always verify the remote actually moved** — a silent success is usually
a stall:

```bash
git ls-remote origin refs/heads/main refs/heads/staging
```

### Applying a migration

No CLI is wired up. Use the Supabase Management API. The token lives in
`C:/Users/Noah/.claude.json` under `mcpServers.supabase.args`:

```js
const mgmt = JSON.parse(fs.readFileSync('C:/Users/Noah/.claude.json','utf8'))
  .mcpServers.supabase.args.find(a => a.startsWith('--access-token=')).split('=')[1];

await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL }),
});
```

⚠️ The **Supabase MCP points at PRODUCTION**. Using MCP tools without thinking
means touching live charity data.

---

## 5. Traps

Every one of these is a real thing that bit someone.

### `NODE_ENV` is `"production"` on staging too

Vercel sets it that way for **every** deployed build. It cannot tell the
environments apart. Two separate features shipped broken because of this — an
email guard that never fired, and the "view as test grantee" button, which
404'd on staging for its entire life. **Use `VERCEL_ENV`.**

### `NEXT_PUBLIC_ENV` is not a safety gate

Operator-typed and inlined at build time, so `"prod"`, `"Production"` or a
value copied between environments all read as "not production". There is a
written post-mortem in `app/lib/impersonation.ts`. Do not reach for it again.

### Resend tags are asymmetric

You **send** an array: `tags: [{ name, value }]`.
The webhook **echoes an object**: `tags: { env: "production" }`.

Reading it back as an array returns `undefined` on every real event — so a
filter built on it silently drops nothing while appearing to work.

### The Resend webhook only points at production

Resend fires one endpoint for every email the account sends, staging's
included, and it can only be filtered by *event type* — not by sender, key or
domain. Staging's events used to be written into the production database, and
the handler guessed `org_id` by matching the recipient against `applications`,
so a staging email to a real family's address would have been attributed to the
real charity. Every send now carries an `env` tag and the webhook drops foreign
ones. **Untagged events are kept** — losing real history is worse than
pollution. Consequence: staging's own email log stays empty until a second
webhook endpoint is registered.

### Supabase Auth email bypasses the app entirely

Magic links and "Confirm your email address" are sent by Supabase, not by this
code, so the staging redirect cannot touch them — and must not, or nobody could
sign in to staging. Never test signup with a non-existent address; it bounces
against the charity's sending domain.

### `super_admin` bypasses tenant gates

`requireAdmin()` lets a platform super_admin through **without any
`org_members` row**. Combined with the fact that `middleware.ts` does **not**
match `/api/*` — so `x-ra-org-slug` is caller-supplied there — a super_admin
can act on any tenant by setting a header. Destructive routes must demand real
membership; see `requireRealMembership` in `app/api/admin/staging-reset/route.ts`.

**This also makes permission tests vacuous.** A pause or permission test signed
in as a super_admin passes for the wrong reason. Pick an admin whose
`profiles.role <> 'super_admin'`.

### `payouts` has no `currency` column

In *either* environment. The payouts export and the "CRA-ready" transactions
ledger both named it and returned 500 on every click, for months, unnoticed.
Exports now `select("*")` because the schema and the code routinely disagree.

### `.env.local` points at PRODUCTION

With a real service-role key, and no `VERCEL_ENV`. Any local safety gate keyed
off "not production" is inert on a dev machine that is talking to live data.

### `Response.text()` strips a leading BOM

A BOM assertion must read `arrayBuffer()` bytes. CSV exports emit a UTF-8 BOM
deliberately so Excel on Windows renders accented names correctly.

### The local build fails on this machine, harmlessly

`@vercel/og` cannot be imported on Windows here, so `npm run build` fails on
the three icon routes. Unrelated to any change you make; Vercel's Linux builds
are fine. Verify with `npx tsc --noEmit` and `npx vitest run` instead.

---

## 6. Map of the code

**Pure logic, unit-tested, no IO.** Put decidable rules here:

| File | What it decides |
|---|---|
| `app/lib/email-env.ts` | Which environment sent an email; where practice mail goes |
| `app/lib/staging-reset.ts` | Whether the erase button may run — 4 gates, all fail closed |
| `app/lib/submit-throttle-logic.ts` | Rate-limit buckets, IP normalisation, honeypot |
| `app/lib/csv.ts` | CSV escaping + spreadsheet formula-injection guard |
| `app/lib/broadcast-logic.ts` | Broadcast ledger rows, retry classification |
| `app/lib/org-routing.ts` | Host → which charity |
| `app/lib/grant-calc.ts` | Reimbursement maths |
| `app/lib/production-safety.test.ts` | Pins what production can never do |

**IO shells** — thin, calling the above: `notify.ts`, `notify-platform.ts`,
`alerts.ts`, `broadcasts.ts`, `submit-throttle.ts`, `payouts.ts`.

**Gates** — `app/lib/admin/require-admin.ts`:

- `requireAdmin()` — session + org role + blocks paused/canceled tenants
- `requireAdminForDataExport()` — same identity checks, **deliberately no
  pause block**, so a lapsed charity can still take its own data

The routes allowed to use the relaxed one are pinned by
`app/lib/admin/export-auth-allowlist.test.ts`. The payout-batch export is
deliberately **not** on it: despite the name, it writes.

**Public funnel** — `app/apply/{family,questions,income,video,contact,review}`.
State lives in `app/store.ts` (zustand, in-memory; a refresh loses it). The
**review page is the only thing that submits**, it awaits the server, and the
server alone decides success. It used to show the success page off an email
promise while the database write was fire-and-forget — a failed save told the
family they had applied.

**Admin** — `app/admin/*`: applications, recipients, payouts, receipts, photos,
broadcasts, reports, `data` (exports + the practice-reset button), settings,
audit-log, email-templates.

**Email sends — there are SEVEN, and three bypass the SDK:**

| Path | How |
|---|---|
| `notify.ts` | Resend SDK — the tenant chokepoint, 7 triggers |
| `notify-platform.ts` | SDK — welcome, trial, past-due |
| `alerts.ts` | SDK — operator alerts |
| `api/admin/invites` | SDK |
| `broadcasts.ts` ×2 | **raw `fetch` to `api.resend.com`** |
| `api/admin/broadcasts/test-send` | **raw `fetch`** |
| `scripts/test-resend.mjs` | SDK, from a laptop, using the shared key |

Anything applied to "all email" must cover the raw-fetch ones too, or it misses
the highest-volume path.

---

## 7. Testing

```bash
npx tsc --noEmit          # types
npx vitest run            # 428 tests, ~13s
```

Tests are **pure-logic only** — no database, no route handlers. Anything left
inside an IO shell is untestable, which is why the split above exists.

End-to-end verification is done by script against the real staging site:
generate a magic link with the service-role key, walk the redirect chain to
collect cookies, then drive the real HTTP endpoints and assert on the database.
Scratch scripts go to `C:\Users\Noah\.claude\tmp\scratch\` — use the absolute
path, since the working directory is the Desktop and bare filenames clutter it.

**The habit that found most of the recent bugs: verify, do not assume.**
Several features described as "existing and working" turned out to be broken
the moment they were actually exercised. Sub-agent reports have also been
factually wrong — one claimed a deleted file was live on both branches. Check
claims against the running system before acting on them.

---

## 8. Known gaps

| Gap | Notes |
|---|---|
| **Stripe unconfigured** | No keys anywhere, so nobody can subscribe, and `trialing` tenants never expire. |
| **Storage deletion unproven** | The practice-reset deletes uploaded receipt/photo files, but staging has no images so that path has never run. Upload one, then erase. |
| **Staging email log empty** | No Resend webhook points at staging. Needs a second endpoint registered. |
| **Mail-consent wording is a draft** | Written by the assistant, live on production. CEO Ministries may want their own words — one-line swap in `app/apply/contact/page.tsx`. |
| **Consent withdrawal is admin-operated** | Family emails, admin clicks a button. No self-serve link. |
| **`staging-bootstrap.sql` is stale** | Missing several migrations; re-creates a dropped insecure column. Do not rebuild staging from it without review. |
| **Migrations cannot build a DB from scratch** | They assume an existing database. |
| **`docs/STAGING_SETUP.md` is stale** | Says the staging Supabase project was deleted. It is alive and in daily use. |

Lower priority, from an earlier audit: Svix webhook replay/timestamp checks,
`whoami` returns an org id without a membership check, storage buckets have no
size or MIME limits, `audit_log` lacks an `(org_id, created_at desc)` index,
`decided_by` foreign keys lack `ON DELETE SET NULL`.

---

## 9. Environment variables

Names only — values live in Vercel. `.env.example` has the annotated list.

**Required**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `APP_HMAC_SECRET`,
`CRON_SECRET`, `RESEND_WEBHOOK_SECRET`, `ADMIN_ALERT_EMAILS`.

`ADMIN_ALERT_EMAILS` deserves a note: it was unset everywhere for a long time,
and `alerts.ts` returns early and silently with no address configured — so
nobody received new-application notifications and it looked like a mail-provider
fault. It is now set to Tierza's address.

**Practice site only — never set on production:**

- `STAGING_EMAIL_REDIRECT_TO` — fallback inbox for sends with no signed-in user
- `RESET_ALLOWED_SUPABASE_REF` — names the ONLY database the erase button may wipe
- `ALLOW_IMPERSONATION=1` — enables "view as test grantee"

All are scoped `[preview]` in Vercel. **The code refuses regardless**, so safety
never depends on a variable merely being absent — `production-safety.test.ts`
pins exactly that, including the case where someone sets them on production by
mistake.

---

## 10. Working with Kevin

- **Plain English.** Say "the code that decides whether the button shows"
  rather than a file path. Keep exact terms only where precision matters.
- **Confirm before anything irreversible or outward-facing** — deleting data,
  sending email, deploying to production. Approval for one thing is not
  approval for the next.
- **Report faithfully.** If a test failed, say so and show the output. If a
  step was skipped, say that. He pushes back on stale or overstated claims and
  is usually right to.
- **He often wants a message he can forward.** When the answer is really for
  Tierza, offer it as plain text, grade-5 English, no markdown.
- Never `git add -A` — the repo carries untracked files that are not yours.
