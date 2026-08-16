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

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_B64 = 7_000_000;  // ~5.2 MB binary; Anthropic's per-image limit is 5 MB
const MAX_PDF_B64   = 10_000_000; // ~7.5 MB binary

/**
 * Pull the most-recent base64 receipt attachment from the replayed message
 * history — a photo (image block) or a scanned receipt (PDF document block).
 * create_receipt consumes the latest one (via ctx.receiptImage) when the admin
 * confirms. Returns null when there is nothing usable attached.
 */
function latestReceiptMedia(messages: any[]): { data: string; mediaType: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      const src = block?.source;
      if (src?.type !== "base64" || typeof src.data !== "string") continue;
      if (block.type === "image" && ALLOWED_IMAGE_TYPES.has(src.media_type)) {
        return { data: src.data, mediaType: src.media_type };
      }
      if (block.type === "document" && src.media_type === "application/pdf") {
        return { data: src.data, mediaType: "application/pdf" };
      }
    }
  }
  return null;
}

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

  const body = (await req.json().catch(() => ({}))) as any;
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages) return NextResponse.json({ error: "messages array required" }, { status: 400 });
  if (messages.length > 80) return NextResponse.json({ error: "conversation too long — start a new chat" }, { status: 400 });

  const confirm = body?.confirm && typeof body.confirm.approved === "boolean"
    ? { approved: body.confirm.approved as boolean }
    : undefined;

  // Extract the most-recent attached receipt photo (if any) and reject an
  // oversized one BEFORE consuming quota, so a rejected upload doesn't burn a unit.
  const receiptImage = latestReceiptMedia(messages) ?? undefined;
  if (receiptImage) {
    const isPdf = receiptImage.mediaType === "application/pdf";
    if (receiptImage.data.length > (isPdf ? MAX_PDF_B64 : MAX_IMAGE_B64)) {
      return NextResponse.json(
        { error: isPdf ? "That PDF is too large — please use one under about 7 MB." : "Receipt image is too large — please use a smaller photo." },
        { status: 413 },
      );
    }
  }

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
