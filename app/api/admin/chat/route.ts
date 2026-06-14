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
import { writeAudit } from "@/app/lib/audit";
import type { ToolContext } from "@/app/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  };

  // Audit a confirmed mutation BEFORE it runs inside the loop (so the trail
  // exists even if the tool later errors). The client echoes the action it's
  // confirming so we can name it precisely.
  if (confirm?.approved && body?.confirm?.action?.name) {
    await writeAudit({
      orgId:       ctx.id,
      actorId:     user.id,
      action:      `ai_chat:${String(body.confirm.action.name).slice(0, 60)}`,
      targetTable: "ai_chat",
      targetId:    user.id,
      details:     { input: body.confirm.action.input ?? null, confirmed: true },
    }).catch(() => { /* never block the chat on an audit write */ });
  }

  try {
    const result = await runAdminChatTurn({
      messages,
      ctx:       toolCtx,
      orgName:   ctx.name,
      userEmail: user.email ?? "admin",
      confirm,
    });
    return NextResponse.json({ ...result, usage });
  } catch (e: any) {
    console.error("[ai/admin-chat] turn failed:", e?.message || e);
    return NextResponse.json({ error: e?.message || "chat failed" }, { status: 500 });
  }
}
