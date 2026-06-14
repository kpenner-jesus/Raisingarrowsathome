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
  `DEFAULT_CHAT_MODEL = claude-sonnet-4-6` (override `ANTHROPIC_MODEL`).
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
- Per-tenant daily cap bounds spend. Tenants can move to their own keys later.
- The feature auto-hides when no key is set (mirrors the Stripe/Resend
  not-configured pattern).

## Migration
`supabase/migrations/20260530_ai_chat_usage.sql` — `ai_chat_usage` table +
`ai_chat_consume(uuid,int)` RPC (REVOKE EXECUTE FROM PUBLIC, granted to
service_role). Applied to prod.

## Follow-ups (not in v1)
- Token streaming (v1 is request/response — text appears when the turn
  settles). Streaming a multi-step tool loop is the main lift.
- Per-tenant model selection (everybooking's `/ai_models` pattern).
- Conversation persistence (v1 chat is client-held + ephemeral).
