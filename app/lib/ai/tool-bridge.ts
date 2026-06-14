// ============================================================
//  tool-bridge.ts — expose the existing MCP tool registry to the
//  in-app admin chat as Anthropic tool definitions.
//
//  The same TOOLS array that powers the external MCP server
//  (app/lib/mcp/tools.ts) drives the chat — one registry, one set of
//  org-scoped handlers. The only chat-specific concern here is which
//  tools MUTATE: those are gated behind an explicit user Confirm in the
//  UI (the run loop halts before executing them).
// ============================================================

import { TOOLS, type ToolContext } from "@/app/lib/mcp/tools";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tools that change tenant data / money / grant decisions. The chat
 * proposes these and waits for an explicit Confirm before running them.
 * Everything else (list_/get_/image-url) is read-only and runs inline.
 *
 * export_batch_csv is included because it flips a draft batch → exported.
 */
export const MUTATING_TOOLS = new Set<string>([
  "decide_application",
  "decide_receipt",
  "modify_recipient",
  "generate_payout_batch",
  "mark_batch_paid",
  "export_batch_csv",
  "bulk_create_recipients",
  "set_user_role",
]);

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

/** Map the registry to Anthropic tool definitions (input_schema = the tool's JSON schema). */
export function anthropicToolDefs(): Anthropic.Tool[] {
  return TOOLS.map((t) => ({
    name:         t.name,
    description:  t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

/** Look up a tool by name. */
export function findTool(name: string) {
  return TOOLS.find((t) => t.name === name) ?? null;
}

/** Execute a tool by name with the caller's org-scoped context. */
export async function runTool(name: string, args: any, ctx: ToolContext): Promise<any> {
  const tool = findTool(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args ?? {}, ctx);
}
