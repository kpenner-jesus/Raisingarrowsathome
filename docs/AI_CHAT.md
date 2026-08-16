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

## Web search (admin chat only)
- Anthropic's **hosted** `web_search_20250305` server tool is attached to the
  admin loop (`WEB_SEARCH_TOOL` in `run.ts`, `max_uses: 4` per turn). The API
  runs the search itself and feeds results back inside the same request, so
  nothing executes on our side, no tenant data is sent to a search engine, and
  it never enters the confirm gate (search can't mutate).
- It comes back as `server_tool_use` + `web_search_tool_result` blocks, NOT
  `tool_use` — the loop's `toolUseBlocks()` filter ignores them, so the turn
  settles as `final`. `toolNames()` in the UI does surface them, so an admin
  can see a lookup happened.
- Used for facts outside the program's data: exchange rates, supplier prices,
  charity/tax rules. The prompt forbids silently converting a receipt's
  currency — the assistant shows the rate and its date, admin decides.
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
  there is no client-side PDF parsing. Capped at `MAX_PDF_B64` (10 MB base64,
  ~7.5 MB file). `create_receipt` stores it like a photo — `sniffReceiptMime()`
  verifies the real `%PDF-` magic bytes and it lands as `.pdf` in the receipts
  bucket. For OpenRouter, `document` is translated to OpenAI's `file` part
  rather than dropped.
- `stripConsumedAttachment()` swaps the photo/PDF for a text marker after a
  receipt is created, so a multi-MB file isn't replayed and re-billed each turn.
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
