// ============================================================
//  provider.ts — per-tenant AI provider resolution + a single
//  createMessage() the chat loop calls regardless of provider.
//
//  - Canonical format is the Anthropic Messages shape (the agentic loop
//    in run.ts is written in it). createMessage returns Anthropic-shaped
//    content blocks either way, so the loop is provider-agnostic.
//  - When a tenant has configured an OpenRouter key + model, calls go to
//    OpenRouter (their key, their cost) via an Anthropic→OpenAI adapter.
//    On ANY OpenRouter failure we auto-fail-over to the platform Anthropic
//    model (Sonnet 5) so the chat never hard-fails.
//  - When no tenant key is configured, the platform Anthropic model is used.
// ============================================================

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, chatModel } from "./anthropic";
import { supabaseService } from "@/app/lib/supabase/server";
import { decryptSecret } from "@/app/lib/crypto";

export type AiConfig =
  | { provider: "anthropic"; model: string }
  | { provider: "openrouter"; model: string; apiKey: string };

export interface LlmRequest {
  system:      string;
  messages:    Anthropic.MessageParam[];
  /** Client tools AND Anthropic server tools (e.g. web_search), which the API
   *  runs itself. Server tools carry a `type` and no `input_schema`. */
  tools?:      Anthropic.MessageCreateParams["tools"];
  max_tokens:  number;
}

export interface LlmResponse {
  content: Anthropic.ContentBlock[];
  /** Which provider actually produced this response (after any failover). */
  via: "anthropic" | "openrouter";
}

/**
 * Resolve the AI config for a tenant. Uses OpenRouter when the tenant has
 * BOTH an (encrypted) OpenRouter key AND a chosen model; otherwise the
 * platform Anthropic model. Never throws — degrades to platform on any error.
 */
export async function resolveAiConfig(orgId: string): Promise<AiConfig> {
  try {
    const svc = supabaseService();
    const [{ data: tenant }, { data: secret }] = await Promise.all([
      svc.from("tenants").select("ai_model").eq("id", orgId).maybeSingle(),
      svc.from("tenant_ai_secrets").select("openrouter_key_encrypted").eq("org_id", orgId).maybeSingle(),
    ]);
    const model = (tenant?.ai_model ?? "").trim();
    const key   = decryptSecret(secret?.openrouter_key_encrypted);
    if (key && model) return { provider: "openrouter", model, apiKey: key };
  } catch (e: any) {
    console.warn("[ai] resolveAiConfig failed, using platform model:", e?.message || e);
  }
  return { provider: "anthropic", model: chatModel() };
}

// ── Anthropic → OpenAI (OpenRouter) translation ─────────────────────────

/** Anthropic tool defs → OpenAI function-tool defs.
 *  Anthropic SERVER tools (web_search) are dropped: they're executed by
 *  Anthropic's API, so they have no schema to translate and no meaning on
 *  OpenRouter. Tenants on their own OpenRouter key get the data tools only. */
export function toOpenAITools(tools?: LlmRequest["tools"]): any[] | undefined {
  const fns = (tools ?? []).filter((t: any) => t?.input_schema);
  if (!fns.length) return undefined;
  return fns.map((t: any) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/** Anthropic system + messages → OpenAI chat messages (text, vision, tools). */
export function toOpenAIMessages(system: string, messages: Anthropic.MessageParam[]): any[] {
  const out: any[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    const content = m.content as any;

    if (m.role === "user") {
      if (typeof content === "string") { out.push({ role: "user", content }); continue; }
      const parts: any[]    = [];
      const toolMsgs: any[] = [];
      for (const b of content) {
        if (b?.type === "text") {
          parts.push({ type: "text", text: b.text });
        } else if (b?.type === "image" && b.source?.type === "base64") {
          parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
        } else if (b?.type === "document" && b.source?.type === "base64") {
          // OpenRouter's PDF shape. Never drop it silently — a dropped
          // attachment would leave the model guessing at a receipt it can't see.
          parts.push({
            type: "file",
            file: { filename: "attachment.pdf", file_data: `data:${b.source.media_type};base64,${b.source.data}` },
          });
        } else if (b?.type === "tool_result") {
          const raw = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          toolMsgs.push({
            role: "tool",
            tool_call_id: b.tool_use_id,
            // OpenAI has no is_error field; make failures explicit in the text.
            content: b.is_error ? `ERROR: ${raw}` : raw,
          });
        }
      }
      // Tool results answer the PRIOR assistant tool_calls, so they must come
      // before any fresh user text/image in the OpenAI ordering.
      for (const tm of toolMsgs) out.push(tm);
      if (parts.length) out.push({ role: "user", content: parts });

    } else if (m.role === "assistant") {
      const arr = Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }];
      let text = "";
      const toolCalls: any[] = [];
      for (const b of arr) {
        if (b?.type === "text") text += b.text;
        else if (b?.type === "tool_use") {
          toolCalls.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
        }
      }
      const am: any = { role: "assistant", content: text || null };
      if (toolCalls.length) am.tool_calls = toolCalls;
      out.push(am);
    }
  }
  return out;
}

/** OpenAI response message → Anthropic content blocks. Tolerates the two
 *  non-standard shapes some OpenRouter-proxied models emit: array-of-parts
 *  content, and tool_calls missing id/name. */
export function fromOpenAI(msg: any): Anthropic.ContentBlock[] {
  const blocks: any[] = [];

  // content may be a string OR an array of parts ([{type:'text',text}, …]).
  let text = "";
  if (typeof msg?.content === "string") {
    text = msg.content;
  } else if (Array.isArray(msg?.content)) {
    text = msg.content
      .map((p: any) => (typeof p === "string" ? p : p?.type === "text" ? (p.text ?? "") : ""))
      .join("");
  }
  if (text.trim()) blocks.push({ type: "text", text });

  for (const tc of msg?.tool_calls ?? []) {
    const id   = tc?.id;
    const name = tc?.function?.name;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
      console.warn("[ai] dropping malformed OpenRouter tool_call", { id, name });
      continue; // never emit a tool_use with undefined id/name
    }
    let input: any = {};
    try { input = JSON.parse(tc?.function?.arguments || "{}"); } catch { input = {}; }
    blocks.push({ type: "tool_use", id, name, input });
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return blocks as Anthropic.ContentBlock[];
}

// ── Provider calls ──────────────────────────────────────────────────────

/** Server tools (web_search) are the ones Anthropic runs itself. */
function isServerTool(t: any): boolean { return !t?.input_schema; }

async function anthropicCreate(req: LlmRequest, model: string): Promise<LlmResponse> {
  const call = (tools?: LlmRequest["tools"]) => anthropic().messages.create({
    model,
    max_tokens: req.max_tokens,
    system:     req.system,
    ...(tools?.length ? { tools } : {}),
    messages:   req.messages,
  });

  try {
    const resp = await call(req.tools);
    return { content: resp.content, via: "anthropic" };
  } catch (e: any) {
    // Hosted web search is an org-level opt-in in the Anthropic Console. If it
    // isn't enabled the API rejects the whole request — which would take down
    // every chat, not just search. Retry once without the server tools so the
    // assistant degrades to data-only instead of going dark.
    const hasServerTool = (req.tools ?? []).some(isServerTool);
    if (!hasServerTool || e?.status !== 400) throw e;
    console.warn("[ai] retrying without server tools (web search unavailable?):", e?.message || e);
    const resp = await call((req.tools ?? []).filter((t: any) => !isServerTool(t)));
    return { content: resp.content, via: "anthropic" };
  }
}

async function openrouterCreate(req: LlmRequest, cfg: Extract<AiConfig, { provider: "openrouter" }>): Promise<LlmResponse> {
  const body: any = {
    model:      cfg.model,
    max_tokens: req.max_tokens,
    messages:   toOpenAIMessages(req.system, req.messages),
  };
  const tools = toOpenAITools(req.tools);
  if (tools) body.tools = tools;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_PLATFORM_URL || "https://raisingarrowsathome.com",
      "X-Title":      "Raising Arrows",
    },
    body: JSON.stringify(body),
    // A hung OpenRouter endpoint would otherwise block until the platform
    // function timeout; abort so createMessage's catch fails over to Anthropic.
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const msg = j?.choices?.[0]?.message;
  if (!msg) throw new Error("OpenRouter returned no message");
  return { content: fromOpenAI(msg), via: "openrouter" };
}

/**
 * Provider-agnostic message creation. OpenRouter when configured (with
 * auto-failover to the platform Anthropic model on any error); platform
 * Anthropic otherwise.
 */
export async function createMessage(req: LlmRequest, cfg: AiConfig): Promise<LlmResponse> {
  if (cfg.provider === "openrouter") {
    try {
      return await openrouterCreate(req, cfg);
    } catch (e: any) {
      console.warn("[ai] OpenRouter failed, falling back to platform Sonnet:", e?.message || e);
      return await anthropicCreate(req, chatModel());
    }
  }
  return await anthropicCreate(req, cfg.model);
}
