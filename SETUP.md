# Raising Arrows — Grant Portal Setup

End-to-end setup for the application → admin review → recipient portal → CEO Ministries payout handoff system.

**Stack:** Next.js 14 (Vercel) · Supabase (Auth + Postgres + Storage) · EmailJS (existing) · Vercel Cron.

**Monthly cost target:** $0 until Supabase free-tier limits (500 MB DB / 1 GB storage). Realistic for years at this volume.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Pick the **Free** plan. Region: closest to Manitoba (us-east is fine).
3. Save the database password (you will not need it again here).
4. Wait ~2 minutes for the project to provision.

## 2. Run the schema

1. In the Supabase dashboard → **SQL Editor** → New Query.
2. Paste the full contents of `supabase/migrations/001_init.sql`.
3. Click **Run**. Should complete in under 5 seconds with no errors.
4. Confirm in **Table Editor**: you should see `profiles`, `applications`, `recipients`, `receipts`, `photos`, `testimonials`, `payout_batches`, `payouts`.

## 3. Grab your Supabase keys

In the Supabase dashboard → **Settings → API**:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key — **secret**, never commit |

## 4. Configure auth email templates (optional polish)

Supabase dashboard → **Authentication → Email Templates**:

- **Magic Link** — change subject to "Sign in to Raising Arrows" and replace the link text with "Sign in to your grant portal".
- **Invite User** — used when admin approves an application. Replace with: "Your Raising Arrows grant has been approved — click below to access your portal".

Both templates use the same `{{ .ConfirmationURL }}` token.

## 5. Configure environment variables locally

Copy `.env.example` → `.env.local`, fill in the values from step 3. Generate `CRON_SECRET` with:

```bash
openssl rand -hex 32
```

Leave the new `EMAILJS_TEMPLATE_*` and `EMAILJS_PRIVATE_KEY` vars empty for now — you can wire admin-decision emails after the rest of the system is verified (see §10). The system silently skips email sends when these are blank.

## 6. Install + run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`. Submit a test application through the apply funnel. Confirm a row appears in Supabase `applications`.

## 7. Create the first admin user

Supabase has no default admin — you make one yourself.

1. Visit `http://localhost:3000/auth/login`. Enter your admin email. Click magic link in your inbox.
2. After signing in, Supabase has created a row in `profiles` for you with `role = 'recipient'`.
3. In Supabase dashboard → **SQL Editor**, run:

   ```sql
   update profiles set role = 'admin' where email = 'YOUR-ADMIN-EMAIL';
   ```

4. Refresh `http://localhost:3000/admin` — you should now see the admin dashboard.

## 8. Deploy to Vercel

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → New Project → import the repo.
3. In **Environment Variables**, add every variable from `.env.local` — including `CRON_SECRET`.
4. Deploy. Vercel will pick up `vercel.json` and register the cron automatically.
5. After first deploy, in Supabase dashboard → **Authentication → URL Configuration**, set:
   - **Site URL** = your Vercel URL (e.g. `https://raisingarrowsathome.ca`).
   - **Redirect URLs** = add `https://YOUR-DOMAIN/auth/callback` and `https://YOUR-DOMAIN/portal`.

## 9. Test the full flow

1. **Apply:** submit a fresh application at `/apply/family`.
2. **Review:** go to `/admin/applications`, click the new row, set the cap (default = sum of age-tier caps), click **Approve**.
3. **Recipient receives invite email.** They click it → land on `/portal`.
4. **Recipient uploads a receipt** at `/portal/receipts/new`.
5. **Admin approves the receipt** at `/admin/recipients/[id]`.
6. **Generate a payout batch** at `/admin/payouts` → "Generate batch now". (Cron will do this automatically on the 1st of each month.)
7. **Download CSV** — this is the document to send to CEO Ministries accounting.
8. CEO Ministries sends the e-transfers manually. Once done, admin clicks **Mark paid** on the batch row. Recipient sees their updated balance.

---

## 10. Wire admin-decision email notifications

The system sends recipients an email automatically when an admin approves/denies an application, approves/rejects a receipt, or marks a payout batch paid. Powered by Resend (free tier: 3,000 emails/month, unlimited templates in code).

1. Sign up at [resend.com](https://resend.com) with `register@raisingarrowsathome.com`. Approve the verification email.
2. Go to [resend.com/api-keys](https://resend.com/api-keys) → Create API Key → name it `raising-arrows-portal` → permission `Sending access` → Create.
3. Copy the key (shown ONCE, starts `re_...`) into `RESEND_API_KEY` in `.env.local` and Vercel → Settings → Environment Variables.
4. Test immediately: approve a test application — recipient should get the approval email within seconds. From address will be `onboarding@resend.dev` until you set up your own domain.
5. (Recommended later) Set up your own sending domain:
   - Resend dashboard → Domains → Add Domain → enter `raisingarrowsathome.com` (or `notifications.raisingarrowsathome.com`).
   - Add the DNS records (DKIM + SPF + Return-Path) it shows to your DNS provider.
   - Wait ~10 min for verification.
   - Set `RESEND_FROM=Raising Arrows <notifications@raisingarrowsathome.com>` in Vercel.

All 5 emails share a single template style (orange brand header, CTA button, footer). Edit them in `app/lib/notify.ts` — they're HTML string literals, no dashboard required. Templates live in version control.

If `RESEND_API_KEY` is missing, notifications are silently skipped (logged as `[notify]`) — the underlying admin action still succeeds.

---

## 11. MCP server — drive the portal from Claude Code

The portal exposes an MCP server at `POST /api/mcp` so Claude (Code, Desktop, or any MCP client) can read + write directly. Bearer-authenticated, admin-only, hosted on your own Vercel deploy. 16 tools cover the full admin surface.

### Mint a token

```powershell
node scripts/mint-mcp-token.mjs register@raisingarrowsathome.com "Kevin laptop"
```

Prints the token ONCE — save it. Only sha256(token) is stored.

### Connect Claude Code (local dev)

```powershell
claude mcp add raising-arrows --scope user --transport http `
  --header "Authorization: Bearer ramcp_xxxxxx" `
  http://localhost:3000/api/mcp
```

Restart Claude Code. Tools appear under `mcp__raising-arrows__*`.

### Connect Claude Code (prod, after Vercel deploy)

Same command, URL = `https://YOUR-DOMAIN/api/mcp`.

### Tools available

| Tool | Purpose |
| --- | --- |
| `list_applications` | Filter by status |
| `get_application` | Full details |
| `list_recipients` | Filter by status |
| `get_recipient` | Includes balance breakdown |
| `list_receipts` | Filter by recipient + status |
| `list_testimonials` | Filter by recipient |
| `list_photos` | By recipient |
| `list_payout_batches` | Filter by status |
| `get_payout_batch` | With line items |
| `get_signed_url` | View a private receipt/photo |
| `decide_application` | Approve/deny — sends email + creates recipient |
| `decide_receipt` | Approve/reject — sends email |
| `modify_recipient` | Change cap/rate/status |
| `generate_payout_batch` | Same logic as monthly cron |
| `mark_batch_paid` | Notify each recipient |
| `export_batch_csv` | Returns CSV text |

### Token management

- Tokens stored in `api_tokens` table. Revoke any time:
  ```sql
  update api_tokens set revoked_at = now() where prefix = 'ramcp_xxxxxxxx';
  ```
- `last_used_at` updates on every call — easy to spot dead tokens.
- Optional expiry: `expires_at` column. Mint script doesn't set it by default (tokens valid forever until revoked). Add it manually in SQL if desired.

### Security

- Bearer header parsed with strict regex (`ramcp_<48 hex>`); anything else rejected as `-32001 unauthorized`.
- Hash check is constant-time via Postgres index lookup.
- HTTP layer enforces admin role — handlers use service-role inside (RLS bypass intentional).
- For prod, set Resend `RESEND_FROM` to your own verified sending domain so emails don't go from `onboarding@resend.dev`.

---

## What recipients see

`/portal` — balance, cap, paid-to-date, eligible-next-payout, list of receipts with statuses, payout history.

`/portal/receipts/new` — upload photo/PDF + amount + date + description.

`/portal/photos` — gallery of uploaded photos.

`/portal/photos/new` — upload a photo + optional caption.

`/portal/testimonials` — share testimonials.

## What admins see

`/admin` — counters for pending work.

`/admin/applications` — every funnel submission. Approve sets the cap and creates a recipient. Deny closes the file.

`/admin/recipients` — list of active recipients with cap + status.

`/admin/recipients/[id]` — balance, **Modify recipient** form (change cap/rate/status), receipts queue (✓/× to approve/reject), photos gallery, testimonials.

`/admin/payouts` — payout batches. Each batch has a downloadable CSV for CEO Ministries.

---

## How the math works

For each active recipient on the 1st of the month:

```
approved_receipt_total = sum(receipts where status = 'approved')
reimbursable          = min(approved_receipt_total * rate, cap)
paid_to_date          = sum(payouts where status = 'paid')
remaining_cap         = max(0, cap - paid_to_date)
next_payout           = max(0, min(reimbursable - paid_to_date, remaining_cap))
```

If `next_payout > 0` a payout line is added to the new batch. The batch starts in `draft` status — admin downloads the CSV (moves to `exported`), then clicks Mark paid once CEO actually sends the e-transfers (`paid`). Recipient dashboards update.

## How to change the rules

- **Reimbursement rate** — per recipient, set at approval. Override later in `recipients` table.
- **Cap** — per recipient, set at approval. Override later in `recipients` table or by editing `app/siteConfig.ts → fundingCaps` for future defaults.
- **Payout schedule** — `vercel.json` cron expression. Current: `0 12 1 * *` = noon UTC on the 1st of each month.
- **Conditional payments (e.g. "require testimonial first")** — extend `calcBalance()` in `app/lib/grant-calc.ts` and pass in the recipient's testimonial count.

## Security

- All admin/portal pages gated by `middleware.ts` — checks Supabase session cookie + role.
- Receipt and photo files live in private Supabase Storage buckets. Recipients can only see their own folder (`auth.uid()/`). Admins can see everything via signed URLs at `/api/admin/receipt-image`.
- Row-level security policies in `001_init.sql` enforce per-table access even if a query slips through.
- Service-role key only used server-side in API routes that already verify admin role.
- `CRON_SECRET` gates the public cron endpoint.

## Files added

```
supabase/migrations/001_init.sql           — schema + RLS + buckets
vercel.json                                — cron schedule
.env.example                               — env template
middleware.ts                              — route protection

app/lib/supabase/{server,browser,middleware}.ts
app/lib/grant-calc.ts                      — payout math
app/lib/notify.ts                          — EmailJS server-side sender
app/lib/types.ts

app/auth/{login,callback,logout}/...

app/admin/{layout, page, applications, recipients, payouts}/...
   admin/recipients/[id]/ModifyForm.tsx    — change cap/rate/status
app/portal/{layout, page, receipts, photos, testimonials}/...

app/api/applications/submit/route.ts
app/api/admin/applications/[id]/decide/route.ts
app/api/admin/receipts/[id]/decide/route.ts
app/api/admin/recipients/[id]/route.ts     — PATCH for modify
app/api/admin/payouts/generate/route.ts
app/api/admin/payouts/[id]/export/route.ts
app/api/admin/payouts/[id]/mark-paid/route.ts
app/api/admin/receipt-image/route.ts
app/api/admin/photo-image/route.ts
app/api/portal/receipts/route.ts
app/api/portal/photos/route.ts
app/api/portal/testimonials/route.ts
app/api/cron/generate-payouts/route.ts

# ── MCP server ──
app/lib/mcp/{auth,server,tools}.ts
app/api/mcp/route.ts
scripts/mint-mcp-token.mjs
supabase/migrations/002_api_tokens.sql
```
