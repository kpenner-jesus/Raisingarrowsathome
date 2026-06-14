import { describe, it, expect } from "vitest";
import { MUTATING_TOOLS, isMutatingTool, anthropicToolDefs, findTool } from "./tool-bridge";
import { TOOLS } from "@/app/lib/mcp/tools";

describe("tool-bridge", () => {
  it("exposes every registry tool as an Anthropic def with a name + schema", () => {
    const defs = anthropicToolDefs();
    expect(defs.length).toBe(TOOLS.length);
    for (const d of defs) {
      expect(typeof d.name).toBe("string");
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.input_schema).toBeTruthy();
      expect((d.input_schema as any).type).toBe("object");
    }
  });

  it("classifies the money/decision tools as mutating", () => {
    for (const name of [
      "decide_application", "decide_receipt", "modify_recipient",
      "generate_payout_batch", "mark_batch_paid", "export_batch_csv",
      "bulk_create_recipients", "set_user_role",
    ]) {
      expect(isMutatingTool(name)).toBe(true);
    }
  });

  it("classifies list_/get_/image tools as read-only", () => {
    for (const name of [
      "list_applications", "get_application", "list_recipients", "get_recipient",
      "list_receipts", "list_testimonials", "list_photos", "list_payout_batches",
      "get_payout_batch", "get_receipt_image_url", "get_photo_image_url",
    ]) {
      expect(isMutatingTool(name)).toBe(false);
    }
  });

  it("every mutating-set name is a real tool (no typos / stale names)", () => {
    for (const name of Array.from(MUTATING_TOOLS)) {
      expect(findTool(name), `mutating tool ${name} not in registry`).toBeTruthy();
    }
  });

  it("unknown tool is not mutating + not found", () => {
    expect(isMutatingTool("nope")).toBe(false);
    expect(findTool("nope")).toBe(null);
  });
});
