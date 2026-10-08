# Raising Arrows: Next.js 15 upgrade plan

Written 2026-10-07. **Done and live the same day** (main 7e5a603). What was found along the way:

- Vercel failed the first build on a lint rule the local run missed; ESLint moved to 8.57 so both agree.
- Browser checks found two hydration errors that already existed on Next 14: unzoned dates on the Team and Applications pages, and the test-grantee banner on every portal page. Both fixed.
- A signed-in walk of 66 pages and endpoints on staging matched the Next 14 run exactly, and there were zero browser errors on 19 admin and 9 portal pages. A real receipt upload went through storage and the admin image viewer and was then deleted, and an application note was added and deleted.
- Live sign-in emails use the `token_hash` link, the same path that was tested.

## Why

The site runs on Next.js 14.2.35, the last release of version 14. Version 14
gets no more security fixes. On 2026-10-07 we closed the advisories that
actually apply to this site: we turned off the unused image optimizer and
moved to the final 14.x patch. The rest are only fixed in 15.5.x and later.
Most of those don't touch this site today: it has no server actions, no
rewrites and no `next/image`. They will matter as soon as someone adds one of
those features. Each new advisory will also be fixed only in 15+.

Target: **Next.js 15.5.27** (latest 15.x) with **React 19**.

## What has to change (measured in this codebase)

| Change in Next 15 | Where it hits us | Size |
|---|---|---|
| `cookies()` and `headers()` become async (`await cookies()`) | `app/lib/supabase/server.ts`, `org-context.ts`, `org-routing.ts`, `impersonation.ts`, `auth/callback`, `portal/profile` route | 6 files directly |
| …so `supabaseServer()` becomes async | 49 calls in 45 files: every server page and API route that checks who is signed in | biggest single job, mechanical |
| …and so does `getOrgContext()` | 17 callers | mechanical |
| Page `params` / `searchParams` props become Promises | 16 pages/layouts | mechanical, mostly done by codemod |
| Route handler `ctx.params` becomes a Promise | 17 API routes (e.g. `exports/[kind]`, `applications/[id]/…`) | mechanical |
| React 18 → 19 | grep found no `defaultProps`, `propTypes`, `forwardRef`, `findDOMNode` or `ReactDOM.render`. Bump `@types/react*`. `zustand` 4.4 → 4.5.x (React 19 peer). | small |
| `@supabase/ssr` 0.5 → 0.12 | cookie adapter moves from `get/set/remove` to `getAll/setAll` in `server.ts` and `lib/supabase/middleware.ts` | small, do with the async change |
| GET route handlers no longer cached by default; `fetch` defaults to no-store | Makes us safer. 65 routes already say `force-dynamic`, and the 12 GET routes that don't are all per-user or cron, so none should be cached anyway | none |
| `eslint-config-next` 15 | still works with our ESLint 8 | version bump |

Middleware keeps working as-is: `request.cookies` was already synchronous.
Nothing else in `next.config.js` needs to change; `images.unoptimized` stays.

## Steps

1. **Branch.** Work on `upgrade/next15`. That branch's Vercel preview uses
   the staging database and the staging email rule (mail goes to the
   signed-in admin), so testing it can't touch live data.
2. **Run the official codemod:** `npx @next/codemod@latest upgrade 15.5.27`.
   It bumps next, react, react-dom and the types, and rewrites most `params`,
   `searchParams`, `cookies()` and `headers()` calls.
3. **Finish by hand:**
   - Make `supabaseServer()` and `getOrgContext()` async and add `await` at
     every caller. The type checker lists each one; build until clean.
   - Move `server.ts` and `lib/supabase/middleware.ts` to the
     `getAll/setAll` cookie API and bump `@supabase/ssr`.
   - Bump `zustand` to 4.5.x and `eslint-config-next` to 15.5.27.
4. **Automatic checks:** `npm run build` with zero type errors, then
   `npm test`, including `production-safety.test.ts`, which guards the
   staging erase button and email routing.
5. **Click-through on the preview URL** (on the staging database):
   - Magic-link sign-in: admin and family.
   - Public apply funnel: shows the "Funding for 2026 is now closed"
     screen. Then switch staging intake to open, submit a test application
     with an address and mail consent, and switch back.
   - Family portal: upload a receipt (photo and PDF), upload a photo, view
     both.
   - Admin: review a receipt, approve an application, receipt image and
     photo viewers, all six CSV exports, the photos zip.
   - "View as test grantee" button, then return to admin.
   - Email template editor and broadcast preview (sandboxed preview still
     renders).
   - AI assistant chat, plus the mobile "More" menu not being covered.
   - Staging erase button: still shows its double warning, and still
     refuses on live (the unit test covers the refusal).
   - Calendar feed `/api/calendar/payouts.ics` and `/api/health`.
6. **Staging, then live.** Merge to `staging`, let Tierza use it for a day,
   then merge to `main`. Watch the Vercel build reach READY, then re-run the
   live smoke checks: home, apply, login, admin redirect, intake status.
7. **Rollback** if anything is wrong on live: Vercel "Instant Rollback" to
   the previous production deployment takes seconds. No database changes
   are involved, so nothing else needs undoing.

## Effort and risk

- About half a day of code work: mostly adding `await` in about 80 places,
  guided by the compiler. Then a few hours of clicking through staging.
- Risk is **low to medium**. The work is wide but shallow. The main way it
  goes wrong is a missed `await`, which shows up as a type error at build
  time, not as silent bad behaviour. No database or data changes.
- Best done in a quiet week, not during intake or a payout run.

## Also worth doing alongside

- `npm audit fix` for the small transitive advisories (nanoid, postcss,
  brace-expansion). Run it after the upgrade so the lock file churns only
  once.
- `docs/STAGING_SETUP.md` is stale. On 2026-10-07 staging was found
  missing eight May migrations (`20260526_*` through `20260530_*`). They
  have now been applied, but staging was built from a separate bootstrap
  script rather than from live, so the two can drift again. Rewrite the doc
  so a rebuild runs every file in `supabase/migrations/` in order.
