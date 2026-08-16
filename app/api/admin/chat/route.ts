// POST /api/admin/chat — in-app operator assistant.
//
// Admin-only (requireAdmin → 423 for paused/canceled tenants). Runs the
// agentic tool loop over the SAME org-scoped registry the MCP exposes;
// mutating tools halt for an explicit Confirm. Bounded by a per-tenant
// daily message cap. Every confirmed mutation is written to audit_log.
//
// Body: { messages: Anthropic.MessageParam[], confirm?: { approved, action? } }
// Reply: { kind, text, messages, pending?, usage }

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";
import { aiReady } from "@/app/lib/ai/anthropic";
import { consumeChatMessage } from "@/app/lib/ai/usage";
import { runAdminChatTurn } from "@/app/lib/ai/run";
import { resolveAiConfig } from "@/app/lib/ai/provider";
import type { ToolContext } from "@/app/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { findReceiptAttachment, totalAttachmentB64, maxB64For, MAX_TOTAL_ATTACHMENT_B64 } from "@/app/lib/ai/attachments";

/**
 * Vercel rejects a serverless request body over ~4.5 MB before our handler
 * runs, so a payload past this never reaches the friendly errors below — it
 * surfaces as an opaque platform 413. Guard well under it, and keep the
 * client's own pre-flight check (AdminChat) in step with this number.
 */
const MAX_BODY_CHARS = 3_800_000;

export async function POST(req: Request) {
  const ready = aiReady();
  if (!ready.ready) {
    return NextResponse.json({ error: `AI chat not configured: ${ready.reason}` }, { status: 503 });
  }

  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user, ctx } = auth;

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json(
      { error: "This chat has grown too large to send — start a new chat (＋)." },
      { status: 413 },
    );
  }
  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })() as any;
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages) return NextResponse.json({ error: "messages array required" }, { status: 400 });
  if (messages.length > 80) return NextResponse.json({ error: "conversation too long — start a new chat" }, { status: 400 });

  const confirm = body?.confirm && typeof body.confirm.approved === "boolean"
    ? { approved: body.confirm.approved as boolean }
    : undefined;

  // Reject an oversized payload BEFORE consuming quota, so a rejected upload
  // doesn't burn a unit. Attachments AND accumulated web-search results both
  // grow the replayed history, so bound the whole thing, not just one block.
  if (totalAttachmentB64(messages) > MAX_TOTAL_ATTACHMENT_B64) {
    return NextResponse.json(
      { error: "This chat is carrying too many attachments — start a new chat (＋) and attach just the file you need." },
      { status: 413 },
    );
  }

  // Which attached file create_receipt will consume, if the admin confirms one.
  // Bounded lookback: see app/lib/ai/attachments.ts for why.
  const attachment = findReceiptAttachment(messages);
  if (attachment && attachment.data.length > maxB64For(attachment.mediaType)) {
    return NextResponse.json(
      { error: attachment.mediaType === "application/pdf"
          ? "That PDF is too large — please use one under about 2 MB."
          : "Receipt image is too large — please use a smaller photo." },
      { status: 413 },
    );
  }
  const receiptImage = attachment
    ? { data: attachment.data, mediaType: attachment.mediaType }
    : undefined;

  // Daily cap (per tenant) — bounds platform LLM spend.
  const usage = await consumeChatMessage(ctx.id);
  if (!usage.allowed) {
    return NextResponse.json(
      { error: `Daily AI chat limit reached (${usage.cap} messages). Try again tomorrow.`, usage },
      { status: 429 },
    );
  }

  const origin = process.env.NEXT_PUBLIC_PLATFORM_URL || new URL(req.url).origin;
  const toolCtx: ToolContext = {
    profile_id: user.id,
    origin,
    org_id:     ctx.id,
    slug:       ctx.slug,
    receiptImage,
  };

  // The audit row for a confirmed mutation is written server-side inside
  // runAdminChatTurn, derived from the ACTUAL executed tool_use block (not the
  // client-echoed action) and only after it succeeds — so the trail can't be
  // spoofed, can't record phantom mutations, and reflects real outcomes.

  const aiConfig = await resolveAiConfig(ctx.id);

  try {
    const result = await runAdminChatTurn({
      messages,
      ctx:       toolCtx,
      orgName:   ctx.name,
      userEmail: user.email ?? "admin",
      aiConfig,
      confirm,
    });
    return NextResponse.json({ ...result, usage });
  } catch (e: any) {
    console.error("[ai/admin-chat] turn failed:", e?.message || e);
    return NextResponse.json({ error: e?.message || "chat failed" }, { status: 500 });
  }
}
