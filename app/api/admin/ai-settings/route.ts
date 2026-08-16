// PATCH /api/admin/ai-settings
//
// Owner-only. Sets the tenant's AI model + OpenRouter API key (encrypted).
// The key is write-only — never returned to the client. Clearing either to
// empty/null removes it (→ the chat falls back to the platform Anthropic model).

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { encryptSecret, secretsReady } from "@/app/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_RE = /^[A-Za-z0-9._:\/-]{1,100}$/; // OpenRouter slug, e.g. anthropic/claude-sonnet-5

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export async function PATCH(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = typeof body?.orgId === "string" ? body.orgId : null;
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  // Model slug → tenants.ai_model (present + non-empty → set; null/empty → clear).
  let modelUpdate: string | null | undefined; // undefined = leave unchanged
  if (has(body, "model")) {
    const v = body.model;
    if (v === null || (typeof v === "string" && v.trim() === "")) {
      modelUpdate = null;
    } else if (typeof v === "string") {
      const m = v.trim();
      if (!MODEL_RE.test(m)) {
        return NextResponse.json({ error: "Model must be an OpenRouter slug like anthropic/claude-sonnet-5" }, { status: 400 });
      }
      modelUpdate = m;
    } else {
      return NextResponse.json({ error: "model must be a string or null" }, { status: 400 });
    }
  }

  // OpenRouter key → tenant_ai_secrets (present + non-empty → encrypt + set; null/empty → clear).
  let keyAction: "set" | "clear" | undefined;
  let keyCipher = "";
  if (has(body, "openrouter_key")) {
    const v = body.openrouter_key;
    if (v === null || (typeof v === "string" && v.trim() === "")) {
      keyAction = "clear";
    } else if (typeof v === "string") {
      if (!secretsReady()) {
        return NextResponse.json(
          { error: "Key storage isn't configured on this deploy (AI_KEY_ENCRYPTION_SECRET missing). Ask the platform owner to set it." },
          { status: 400 },
        );
      }
      const k = v.trim();
      if (k.length < 20) {
        return NextResponse.json({ error: "That doesn't look like a valid OpenRouter API key." }, { status: 400 });
      }
      keyCipher = encryptSecret(k);
      keyAction = "set";
    } else {
      return NextResponse.json({ error: "openrouter_key must be a string or null" }, { status: 400 });
    }
  }

  if (modelUpdate === undefined && keyAction === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: membership } = await svc
    .from("org_members").select("role")
    .eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Only the organization owner can change AI settings." }, { status: 403 });
  }

  if (modelUpdate !== undefined) {
    const { error } = await svc.from("tenants").update({ ai_model: modelUpdate }).eq("id", orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (keyAction === "set") {
    const { error } = await svc.from("tenant_ai_secrets")
      .upsert({ org_id: orgId, openrouter_key_encrypted: keyCipher, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (keyAction === "clear") {
    const { error } = await svc.from("tenant_ai_secrets").delete().eq("org_id", orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
