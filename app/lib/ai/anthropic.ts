// ============================================================
//  anthropic.ts — server-side Claude client for the in-app AI chat.
//
//  Env:
//    ANTHROPIC_API_KEY   sk-ant-...  (platform key — platform pays)
//    ANTHROPIC_MODEL     optional override; defaults to Sonnet 5
//
//  The key is platform-wide for now (every tenant shares it); a
//  per-tenant daily message cap (app/lib/ai/usage.ts) bounds spend.
//  Mirrors the stripeReady()/resend() lazy-guard pattern used
//  elsewhere so a missing key degrades to "not configured" instead
//  of throwing at import time.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

// Sonnet 5 balances tool-calling quality against cost for a chat
// assistant on $20/mo tenants. Override per-deploy with ANTHROPIC_MODEL.
export const DEFAULT_CHAT_MODEL = "claude-sonnet-5";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  cached = new Anthropic({ apiKey });
  return cached;
}

export function chatModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_CHAT_MODEL;
}

/** Is the AI chat configured well enough to attempt a call? */
export function aiReady(): { ready: boolean; reason?: string } {
  if (!process.env.ANTHROPIC_API_KEY) return { ready: false, reason: "ANTHROPIC_API_KEY missing" };
  return { ready: true };
}
