// ============================================================
//  run.ts — agentic tool loop for the admin operator chat.
//
//  Protocol (stateless server; the CLIENT holds the full Anthropic
//  message history and replays it each turn):
//
//   POST a turn with { messages } →
//     - read-only tools execute inline; the loop continues until Claude
//       returns plain text → { kind: "final", messages, text }.
//     - the moment Claude wants a MUTATING tool, the loop HALTS without
//       executing and returns { kind: "pending", messages, pending }.
//       `messages` already includes the assistant turn carrying the
//       tool_use, so the client stores it and re-POSTs with `confirm`.
//
//   POST with { messages, confirm: { approved } } → the last assistant
//     turn's tool_use(s) are executed (approved) or declined, a
//     tool_result is appended for EVERY tool_use in that turn (Anthropic
//     requires one per id), then the loop resumes.
//
//  v1 is non-streaming: a turn returns once it settles (final or pending).
// ============================================================

import type Anthropic from "@anthropic-ai/sdk";
import { createMessage, type AiConfig } from "./provider";
import { anthropicToolDefs, isMutatingTool, runTool } from "./tool-bridge";
import { writeAudit } from "@/app/lib/audit";
import type { ToolContext } from "@/app/lib/mcp/tools";

const MAX_STEPS = 8;          // bounds tool round-trips (and cost) per turn
const MAX_TOKENS = 1500;

export interface PendingAction {
  tool_use_id: string;
  name:        string;
  input:       any;
}

export type TurnResult =
  | { kind: "final";   messages: Anthropic.MessageParam[]; text: string }
  | { kind: "pending"; messages: Anthropic.MessageParam[]; text: string; pending: PendingAction };

function systemPrompt(orgName: string, userEmail: string, todayISO: string): string {
  return [
    `You are the operator assistant for "${orgName}", a grant program running on the Raising Arrows platform.`,
    `You are talking to an admin (${userEmail}). Today is ${todayISO}.`,
    ``,
    `You can read the program's data (applications, recipients, receipts, payouts, testimonials, photos) and PROPOSE changes.`,
    `Read-only lookups run automatically. Any change that touches money or grant decisions (approving/denying applications, deciding receipts, creating receipts, generating or marking payout batches, modifying recipients, importing families, changing team roles) is shown to the admin to CONFIRM before it runs — never claim a change is done until it is confirmed and executed.`,
    `When the admin attaches a receipt photo, read it carefully and extract the total amount, the purchase date (YYYY-MM-DD if legible), the currency (CAD unless clearly USD), and a short description of what was purchased. Resolve which recipient it belongs to — use the name the admin gives and look it up with list_recipients; if the family is ambiguous or unstated, ask before proposing. Then propose create_receipt (it is created as 'pending' for review). State the amount, recipient, and date in your message so the admin can verify before confirming.`,
    `Be concise and concrete. Use the tools rather than guessing. When you show numbers, format currency clearly. If you're unsure which record the admin means, ask.`,
  ].join("\n");
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content.filter((b) => b.type === "text").map((b: any) => b.text).join("").trim();
}

function toolUseBlocks(content: Anthropic.ContentBlock[]): Anthropic.ToolUseBlock[] {
  return content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
}

/**
 * Replace heavy base64 image blocks in the history with a light text marker
 * once they've been consumed (a receipt was created from one). Without this the
 * full image is replayed — and re-billed by the model — on every later turn.
 * Mutates each message's content in place.
 */
function stripImageBlocks(messages: Anthropic.MessageParam[]): void {
  // Strip ONLY the most-recent image (the one create_receipt just consumed),
  // mirroring latestReceiptImage's newest-first selection — so any earlier,
  // not-yet-entered photo in a multi-receipt session survives.
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    for (let j = c.length - 1; j >= 0; j--) {
      if ((c as any[])[j]?.type === "image") {
        (c as any[])[j] = { type: "text", text: "[receipt photo — entered]" };
        return;
      }
    }
  }
}

/** Execute a set of tool_use blocks → tool_result content blocks (one per id). */
async function executeToolUses(
  blocks: Anthropic.ToolUseBlock[],
  ctx: ToolContext,
  opts: { declineAll?: boolean } = {},
): Promise<Anthropic.ToolResultBlockParam[]> {
  return Promise.all(blocks.map(async (b): Promise<Anthropic.ToolResultBlockParam> => {
    if (opts.declineAll) {
      return { type: "tool_result", tool_use_id: b.id, content: "The admin declined this action; it was not performed.", is_error: false };
    }
    try {
      const result = await runTool(b.name, b.input, ctx);
      const text = typeof result === "string" ? result : JSON.stringify(result);
      return { type: "tool_result", tool_use_id: b.id, content: text.slice(0, 20000) };
    } catch (e: any) {
      return { type: "tool_result", tool_use_id: b.id, content: `Error: ${e?.message || "tool failed"}`, is_error: true };
    }
  }));
}

export interface RunArgs {
  messages:  Anthropic.MessageParam[];
  ctx:       ToolContext;
  orgName:   string;
  userEmail: string;
  /** Per-tenant AI provider config (OpenRouter or platform Anthropic). */
  aiConfig:  AiConfig;
  /** When present, resume a pending action from the prior turn. */
  confirm?:  { approved: boolean };
}

/**
 * Plain single-shot chat with NO tools — used by the portal family helper.
 * The model answers only from the injected system context (the family's own
 * grant data), so there is no tool surface to leak across tenants.
 */
export async function runPortalChatTurn(
  args: { messages: Anthropic.MessageParam[]; system: string; aiConfig: AiConfig },
): Promise<{ messages: Anthropic.MessageParam[]; text: string }> {
  const resp = await createMessage(
    { system: args.system, messages: args.messages, max_tokens: 800 },
    args.aiConfig,
  );
  const messages: Anthropic.MessageParam[] = [...args.messages, { role: "assistant", content: resp.content }];
  return { messages, text: textOf(resp.content) };
}

export async function runAdminChatTurn(args: RunArgs): Promise<TurnResult> {
  const system = systemPrompt(args.orgName, args.userEmail, new Date().toISOString().split("T")[0]);
  const tools  = anthropicToolDefs();
  const work: Anthropic.MessageParam[] = [...args.messages];

  // ── Resume path: execute (or decline) the last assistant turn's tool_use(s). ──
  if (args.confirm) {
    const lastAssistant = [...work].reverse().find((m) => m.role === "assistant");
    const blocks = lastAssistant && Array.isArray(lastAssistant.content)
      ? toolUseBlocks(lastAssistant.content as Anthropic.ContentBlock[])
      : [];
    if (blocks.length > 0) {
      const results = await executeToolUses(blocks, args.ctx, { declineAll: !args.confirm.approved });
      work.push({ role: "user", content: results });

      // Authoritative audit: write one row per mutating tool that actually ran
      // and succeeded, sourced from the REAL executed block (name + input) —
      // not the client-echoed action. No phantom rows, no spoof, outcome-aware.
      if (args.confirm.approved) {
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (!isMutatingTool(b.name) || results[i]?.is_error) continue;
          await writeAudit({
            orgId:       args.ctx.org_id,
            actorId:     args.ctx.profile_id,
            action:      `ai_chat:${b.name.slice(0, 60)}`,
            targetTable: "ai_chat",
            targetId:    args.ctx.profile_id,
            details:     { input: b.input ?? null, confirmed: true },
          }).catch(() => { /* never block the chat on an audit write */ });
        }
      }

      // A receipt was just created from the attached photo → drop the now-
      // consumed image from history so it isn't replayed + re-billed.
      const createdReceipt = args.confirm.approved
        && blocks.some((b, i) => b.name === "create_receipt" && !results[i]?.is_error);
      if (createdReceipt) stripImageBlocks(work);
    }
  }

  // ── Loop ──
  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await createMessage(
      { system, messages: work, tools, max_tokens: MAX_TOKENS },
      args.aiConfig,
    );
    work.push({ role: "assistant", content: resp.content });

    const uses = toolUseBlocks(resp.content);
    if (uses.length === 0) {
      return { kind: "final", messages: work, text: textOf(resp.content) };
    }

    // If the turn wants any mutating tool, halt the WHOLE turn for confirm
    // (Anthropic requires a tool_result for every tool_use id when we resume,
    // so we can't partially execute). The first mutating use drives the prompt.
    const firstMutating = uses.find((u) => isMutatingTool(u.name));
    if (firstMutating) {
      return {
        kind: "pending",
        messages: work,
        text: textOf(resp.content),
        pending: { tool_use_id: firstMutating.id, name: firstMutating.name, input: firstMutating.input },
      };
    }

    // All read-only — execute inline and continue.
    const results = await executeToolUses(uses, args.ctx);
    work.push({ role: "user", content: results });
  }

  // Hit the step ceiling — return whatever text we have.
  const lastAssistant = [...work].reverse().find((m) => m.role === "assistant");
  const text = lastAssistant && Array.isArray(lastAssistant.content)
    ? textOf(lastAssistant.content as Anthropic.ContentBlock[])
    : "I stopped after several steps. Could you narrow the request?";
  return { kind: "final", messages: work, text };
}
