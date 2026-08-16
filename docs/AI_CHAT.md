# AI Chat Assistant

Two in-app AI chat surfaces, both built Next-native (no port of the
everybooking Rails assistant — that was the behavior reference only).

## Surfaces

### 1. Admin operator assistant (`/admin/*`)
- Floating ✦ button → right drawer. Component: `app/admin/_components/AdminChat.tsx`.
- API: `POST /api/admin/chat` — `requireAdmin()` (admin-only; 423 for
  paused/canceled tenants; per-tenant daily cap).
- Runs the **same org-scoped tool registry the MCP exposes**
  (`app/lib/mcp/tools.ts`, 19 tools) via `app/lib/ai/run.ts`.
- **Read-only tools run automatically** (list_/get_/image-url).
- **Mutating tools halt for an explicit Confirm** in the UI before
  executing (decide_application, decide_receipt, modify_recipient,
  generate_payout_batch, mark_batch_paid, export_batch_csv,
  bulk_create_recipients, set_user_role — see `tool-bridge.ts`).
- Confirmed mutations write an `audit_log` row; the page `router.refresh()`es
  ~1.2s after a confirmed change.

### 2. Family help assistant (`/portal/*`)
- Floating ? button → drawer. Component: `app/portal/_components/PortalChat.tsx`.
- API: `POST /api/portal/chat` — signed-in family only; 423 when paused; cap.
- **No tools.** The model answers only from the signed-in family's OWN grant
  data (balance, receipts, payouts, deadline) injected as system context by
  `app/lib/ai/portal-context.ts`. It cannot reach any other family's data or
  any admin action — there is no tool surface to leak through.

## Engine
- `app/lib/ai/anthropic.ts` — lazy client + `aiReady()` guard +
  `DEFAULT_CHAT_MODEL = claude-sonnet-5` (override `ANTHROPIC_MODEL`).
- `app/lib/ai/tool-bridge.ts` — maps `TOOLS` → Anthropic tool defs +
  read/mutating classification.
- `app/lib/ai/run.ts` — `runAdminChatTurn` (tool loop, confirm-gating,
  MAX_STEPS=8) + `runPortalChatTurn` (single-shot, no tools).
- `app/lib/ai/usage.ts` + `ai_chat_consume` RPC — race-safe per-tenant daily
  message cap (default 200; override `AI_CHAT_DAILY_CAP`).

## Confirm protocol (admin)
The client holds the raw Anthropic message array and replays it each turn.
When Claude wants a mutating tool, the server returns
`{ kind: "pending", messages, pending: {tool_use_id, name, input} }` WITHOUT
executing. The client shows a Confirm/Cancel card and re-POSTs with
`{ messages, confirm: { approved, action } }`. On resume the whole assistant
turn's tool_use(s) are executed (or declined) — every tool_use gets a
tool_result, satisfying Anthropic's API rule — then the loop continues.

## Config / cost
- One platform `ANTHROPIC_API_KEY` (platform pays). Seeded locally in
  `.env.local` (gitignored) from everybooking's `credentials.dig(:claude,
  :api_key)`. **Add `ANTHROPIC_API_KEY` to Vercel for prod** — without it both
  surfaces hide (the `aiReady()` gate) and the routes return 503.
- Per-tenant daily cap bounds spend. The platform key is also the automatic
  backup/failover for tenants on their own provider (see below).
- The feature auto-hides when no key is set (mirrors the Stripe/Resend
  not-configured pattern).

## Per-tenant BYO OpenRouter key
- A tenant OWNER can run the assistant on their own OpenRouter account + model
  at **Settings → AI** (`app/admin/settings/ai/`, owner-gated; key field is
  write-only). Resolution + the provider abstraction live in
  `app/lib/ai/provider.ts`: `resolveAiConfig(orgId)` → OpenRouter when BOTH an
  (encrypted) key and a model are set, else the platform Anthropic model.
- `createMessage()` is the single provider-agnostic call the loop uses. The loop
  stays in Anthropic Messages shape; provider.ts translates Anthropic↔OpenAI
  (tools, tool_use/tool_result, base64 images) for the OpenRouter path. **Any**
  OpenRouter error (incl. a 45s timeout) auto-fails-over to platform Sonnet 5.
- Keys are AES-256-GCM encrypted (`app/lib/crypto.ts`, env
  `AI_KEY_ENCRYPTION_SECRET` — `openssl rand -hex 32`) and stored in the
  service-role-only `tenant_ai_secrets` table (RLS on, no policies); the model
  slug is `tenants.ai_model`. Save route: `app/api/admin/ai-settings/route.ts`.

## Migrations
- `supabase/migrations/20260530_ai_chat_usage.sql` — `ai_chat_usage` table +
  `ai_chat_consume(uuid,int)` RPC (EXECUTE revoked from public/anon/authenticated,
  granted to service_role). Applied to prod + staging.
- `supabase/migrations/20260614_tenant_ai_settings.sql` — `tenants.ai_model` +
  `tenant_ai_secrets` table. Applied to prod + staging.

## Deleting records (admin chat only)
Bad data gets in — a double import can stamp payouts as "paid" that never
happened — and nothing could remove them. `delete_record` can, loudly.

- `preview_delete` (read-only, auto-runs) reports the row, how many related
  rows would go with it, whether it changes what a family is owed, and any
  stored file. The prompt requires it BEFORE a delete is proposed.
- `delete_record` is a mutating tool, so it halts for Confirm. The card is
  red, says "permanent", shows the recorded reason, and puts **Cancel first
  in the primary style** — the safe choice should be under your thumb.
- **Archive first, fail closed.** The full row is inserted into `audit_log`
  BEFORE the delete and the delete is abandoned if that write fails.
  `writeAudit()` deliberately swallows its errors so an audit hiccup can't
  break a normal request; that trade is wrong here, so this insert is done
  directly. A mistaken delete is recoverable by hand from the audit row.
- **Whitelist** (`app/lib/mcp/deletable.ts`): payouts, receipts, photos,
  testimonials, payout_batches, recipients, applications. `audit_log`,
  `tenants`, `org_members` and `profiles` are absent on purpose — nothing in
  a chat should be able to delete the record of what a chat did.
- **No silent cascades.** Deleting a recipient also destroys their receipts,
  photos, testimonials, payouts and notes; the counts must be shown and
  `cascade: true` passed. An application is BLOCKED by its recipients
  (ON DELETE RESTRICT), caught here so the admin gets a sentence rather than
  a Postgres error.
- The cascade map was read from the LIVE database (`pg_constraint`), not the
  repo migrations. `recipient_notes`, `application_notes` and the
  `receipts.duplicate_of_id` self-link are all missing from the checked-in
  SQL, and each would have been under-reported. Verify against the DB when
  adding a table.
- **`chatOnly: true`** — hidden from the external MCP server. The Confirm
  step IS the safeguard and it only exists in the chat UI; over MCP a token
  holder would delete instantly. `preview_delete` stays exposed (read-only).
- One record per call. A written reason (>=10 chars) is required and stored.

## Web search (admin chat only)
- Anthropic's **hosted** `web_search_20250305` server tool is attached to the
  admin loop (`WEB_SEARCH_TOOL` in `run.ts`, `max_uses: 4` per turn). The API
  runs the search itself and feeds results back inside the same request, so
  nothing executes on our side and it never enters the confirm gate (search
  can't mutate). It does NOT follow that tenant data can't leave — see below.
- It comes back as `server_tool_use` + `web_search_tool_result` blocks, NOT
  `tool_use` — the loop's `toolUseBlocks()` filter ignores them, so the turn
  settles as `final`. `activityLines()` in the UI does surface them, with the
  query text, so a lookup is never invisible.
- Used for facts outside the program's data: exchange rates, supplier prices,
  charity/tax rules. The prompt forbids silently converting a receipt's
  currency — the assistant shows the rate and its date, admin decides.
- **It is an outbound channel, and this chat is full of family PII.** The
  model writes the query, and a query can't be intercepted mid-request, so
  there are two controls: the system prompt forbids putting any name, email,
  phone, address or receipt link in a search, and the UI prints the QUERY
  TEXT next to the turn (`activityLines`) so an admin can see what left.
  Treat the prompt rule as the real boundary and the display as the check.
- Search results, and attached file NAMES, are declared untrusted in the
  prompt: information to report on, never instructions to follow. A Drive
  file is named by whoever shared it, so `safeName()` also flattens control
  characters and strips brackets before a name enters the prompt.
- `AI_WEB_SEARCH=0` turns it off without a code change. If Anthropic rejects
  the request because the org hasn't enabled hosted search, `anthropicCreate`
  retries once WITHOUT server tools — otherwise one org-level setting would
  take down every chat, not just search.
- **Not on the OpenRouter path.** Server tools have no `input_schema`, so
  `toOpenAITools()` filters them out; enabling OpenRouter's own web plugin
  would silently change a tenant's model + billing. Tenants on a BYO key get
  the data tools only.
- Billed per search (platform key). Bounded by `max_uses` × the daily cap.

## File attachments (admin chat)
- **Images** (receipt photos) → compressed client-side, sent as an Anthropic
  image block; `create_receipt` consumes the latest one on confirm.
- **PDFs** (scanned/emailed receipts) → sent whole as an Anthropic `document`
  block. Claude reads PDFs natively, including scans with no text layer, so
  there is no client-side PDF parsing. Capped at `MAX_PDF_B64` (3 MB base64,
  ~2.2 MB file) — **not** Anthropic's limit but the hosting platform's ~4.5 MB
  request-body limit, which the whole replayed conversation shares. The size
  is checked on `file.size` BEFORE the read, because base64-ing a 300 MB file
  just to reject it freezes the tab. `create_receipt` stores it like a photo — `sniffReceiptMime()`
  verifies the real `%PDF-` magic bytes and it lands as `.pdf` in the receipts
  bucket. For OpenRouter, `document` is translated to OpenAI's `file` part
  rather than dropped.
- **`app/lib/ai/attachments.ts` is the single definition of "which attached
  file is the receipt".** The route (feeding `create_receipt`) and the loop
  (stripping the file afterwards) both call `findReceiptAttachment()`, which
  returns the block's POSITION — so they cannot select different blocks and
  either re-bill a consumed file or destroy an untouched one.
- That lookback is **bounded** to the last 2 admin-authored messages. A photo
  in an admin chat is nearly always a receipt; a PDF plausibly isn't. Without
  the bound, a budget PDF attached six turns earlier could become the stored
  evidence for a receipt created later. The window still covers attach-and-ask
  and attach-then-clarify.
- `stripAttachmentAt()` swaps the photo/PDF for a text marker after a receipt
  is created, so a multi-MB file isn't replayed and re-billed each turn.
- The route also bounds the TOTAL payload (`MAX_BODY_CHARS`, and
  `MAX_TOTAL_ATTACHMENT_B64`), and the client pre-flights the same number, so
  an over-large chat fails with a readable message instead of an opaque
  platform rejection. `post()` checks the status BEFORE parsing, since a
  platform 413 is not JSON.
- A failed send is ROLLED BACK out of the history. Otherwise the rejected
  turn is replayed — and fails identically — on every later message.
- Detection (`sniffKind`) prefers MIME but falls back to the **extension** for
  images and PDFs, because some browsers hand us a blank `file.type`. The
  image-extension fallback is checked LAST so it can't shadow `.xlsx`/`.csv`.
  HEIC/HEIF is rejected with a "export it as JPG" message — canvas can't
  decode it and Anthropic doesn't accept it.
- **Spreadsheets / data files** (`.xlsx`, `.csv`, `.tsv`, `.txt`, `.md`,
  `.json`, `.log`) → converted to text **client-side** by
  `app/lib/ai/file-text.ts` and sent as a labelled text block
  (`[Attached file: name]`). Client-side is deliberate: the server is
  stateless and the client replays the message array each turn, so converting
  once puts the text in the history instead of re-converting every turn.
- `.xlsx` is parsed with **JSZip** (already a dependency) by reading
  `sharedStrings.xml` + `worksheets/sheetN.xml` directly — we avoid the npm
  `xlsx`/SheetJS package because 0.18.5 carries a prototype-pollution
  advisory (CVE-2023-30533). Numeric dates/currency come through as Excel's
  raw serial values; the attachment label says so so the model asks rather
  than guessing.
- Legacy `.xls` (binary BIFF) is **not** parseable this way — the user gets a
  clear "re-save as .xlsx or .csv" message instead of a cryptic failure.
- Extracted text is capped at `MAX_FILE_TEXT` (80k chars) and flagged as
  truncated in the UI.
- **From Google Drive** — 📎 opens a two-option menu when Drive is configured
  (local file / Drive), and goes straight to the local picker when it isn't, so
  the click count is unchanged for tenants not using it. The picked file is
  handed to the same `attachFile()` path. Client-side only, `drive.file` scope,
  no server-side Google credential — see `docs/GOOGLE_DRIVE.md`.

## Follow-ups (not in v1)
- Token streaming (v1 is request/response — text appears when the turn
  settles). Streaming a multi-step tool loop is the main lift.
- Conversation persistence (v1 chat is client-held + ephemeral).
