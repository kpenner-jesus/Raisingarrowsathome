import { describe, it, expect } from "vitest";
import { TOOLS } from "./tools";
import { MUTATING_TOOLS } from "../ai/tool-bridge";

const byName = (n: string) => TOOLS.find((t: any) => t.name === n) as any;

describe("email template tools", () => {
  it("exposes the full lifecycle the admin asked for", () => {
    for (const n of [
      "list_email_templates", "get_email_template",
      "create_email_template", "update_email_template", "archive_email_template",
    ]) {
      expect(byName(n), `missing tool: ${n}`).toBeTruthy();
    }
  });

  it("gates the ones that change what a family receives", () => {
    expect(MUTATING_TOOLS.has("create_email_template")).toBe(true);
    expect(MUTATING_TOOLS.has("update_email_template")).toBe(true);
    expect(MUTATING_TOOLS.has("archive_email_template")).toBe(true);
    // reads stay free, or the assistant can't show the admin what it's changing
    expect(MUTATING_TOOLS.has("list_email_templates")).toBe(false);
    expect(MUTATING_TOOLS.has("get_email_template")).toBe(false);
  });

  it("keeps template editing available over the external MCP server", () => {
    // Unlike delete_record, editing copy is reversible and non-destructive.
    for (const n of ["list_email_templates", "create_email_template", "update_email_template", "archive_email_template"]) {
      expect(byName(n).chatOnly).toBeFalsy();
    }
  });

  it("tells the model that a brand-new key sends nothing", () => {
    // Without this, "make a reminder email" creates a row and reports success
    // as though something will now go out.
    const d = byName("create_email_template").description;
    expect(d).toMatch(/only stored copy|nothing sends it/i);
    expect(d).toContain("welcome_family");
  });

  it("names welcome_family as a key the system actually sends", () => {
    expect(byName("create_email_template").description).toContain("welcome_family");
    expect(byName("create_email_template").description).toContain("application_approved");
  });

  it("says archiving falls back rather than stopping the email", () => {
    expect(byName("archive_email_template").description).toMatch(/does NOT delete/i);
    expect(byName("archive_email_template").description).toMatch(/default wording/i);
  });

  it("requires a key everywhere it acts on one", () => {
    for (const n of ["get_email_template", "update_email_template", "archive_email_template"]) {
      expect(byName(n).inputSchema.required).toContain("key");
    }
    expect(byName("create_email_template").inputSchema.required)
      .toEqual(expect.arrayContaining(["key", "label", "subject", "body_html"]));
  });
});
