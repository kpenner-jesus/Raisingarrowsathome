// ============================================================
//  usage.ts — per-tenant daily message cap for the AI chat.
//
//  One platform Anthropic key pays for all tenants, so we bound spend
//  with a per-tenant per-day message ceiling. Each user message (admin
//  or portal) consumes one unit via the race-safe ai_chat_consume RPC.
// ============================================================

import { supabaseService } from "@/app/lib/supabase/server";

/** Daily message ceiling per tenant. Override with AI_CHAT_DAILY_CAP. */
export function dailyCap(): number {
  const n = Number(process.env.AI_CHAT_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

export interface ConsumeResult {
  allowed: boolean;
  used:    number;
  cap:     number;
}

/**
 * Atomically count one chat message against the tenant's daily cap.
 * Returns allowed=false once the cap is exceeded for the UTC day.
 * Fails OPEN on an RPC error (don't block the product on a metering blip).
 */
export async function consumeChatMessage(orgId: string): Promise<ConsumeResult> {
  const cap = dailyCap();
  const svc = supabaseService();
  const { data, error } = await svc.rpc("ai_chat_consume", { p_org_id: orgId, p_cap: cap });
  if (error) {
    console.warn("[ai/usage] ai_chat_consume failed (failing open):", error.message);
    return { allowed: true, used: 0, cap };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: !!row?.allowed, used: Number(row?.used ?? 0), cap };
}
