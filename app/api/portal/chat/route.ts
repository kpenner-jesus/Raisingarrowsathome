// POST /api/portal/chat — read-only help assistant for grant FAMILIES.
//
// No tools. The model answers only from the signed-in family's own grant
// data (balance, receipts, payouts, deadline), injected as system context.
// It cannot reach other families' data and cannot make any changes.
//
// Body: { messages: Anthropic.MessageParam[] }
// Reply: { text, messages, usage }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";
import { getEffectiveRecipient } from "@/app/lib/impersonation";
import { isTenantAccessBlocked } from "@/app/lib/tenant-access";
import { aiReady } from "@/app/lib/ai/anthropic";
import { consumeChatMessage } from "@/app/lib/ai/usage";
import { buildPortalContext } from "@/app/lib/ai/portal-context";
import { runPortalChatTurn } from "@/app/lib/ai/run";
import { resolveAiConfig } from "@/app/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ready = aiReady();
  if (!ready.ready) return NextResponse.json({ error: `AI chat not configured: ${ready.reason}` }, { status: 503 });

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgCtx = await requireOrgContext();
  if (isTenantAccessBlocked(orgCtx.status)) return NextResponse.json({ error: "portal is paused" }, { status: 423 });

  const body = (await req.json().catch(() => ({}))) as any;
  const rawMessages = Array.isArray(body?.messages) ? body.messages : null;
  if (!rawMessages) return NextResponse.json({ error: "messages array required" }, { status: 400 });
  if (rawMessages.length > 60) return NextResponse.json({ error: "conversation too long — start a new chat" }, { status: 400 });

  // The portal helper is text-only (no tools, no vision). Strip any image
  // blocks so a hand-crafted client can't push large images billed to the
  // shared platform key — the normal portal UI never sends images anyway.
  const messages = rawMessages.map((m: any) =>
    Array.isArray(m?.content)
      ? { ...m, content: m.content.map((b: any) => (b?.type === "image" ? { type: "text", text: "[image omitted]" } : b)) }
      : m,
  );

  // Resolve the family's OWN recipient row (org-scoped) and build context.
  const eff = await getEffectiveRecipient(user.id, orgCtx.id);
  const recipient = eff.recipient;
  if (!recipient) {
    return NextResponse.json({
      text: "Your account isn't linked to an active grant yet, so I don't have any grant details to show. If you think this is a mistake, please contact the program.",
      messages,
    });
  }

  const usage = await consumeChatMessage(orgCtx.id);
  if (!usage.allowed) {
    return NextResponse.json({ error: `Daily chat limit reached (${usage.cap}). Try again tomorrow.`, usage }, { status: 429 });
  }

  const built = await buildPortalContext(recipient, orgCtx.id, orgCtx.name);
  if (!built.ok || !built.system) {
    return NextResponse.json({ text: "I couldn't load your grant details right now. Please try again shortly.", messages });
  }

  const aiConfig = await resolveAiConfig(orgCtx.id);

  try {
    const result = await runPortalChatTurn({ messages, system: built.system, aiConfig });
    return NextResponse.json({ ...result, usage });
  } catch (e: any) {
    console.error("[ai/portal-chat] turn failed:", e?.message || e);
    return NextResponse.json({ error: e?.message || "chat failed" }, { status: 500 });
  }
}
