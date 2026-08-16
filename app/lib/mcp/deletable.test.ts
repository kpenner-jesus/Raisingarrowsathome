import { describe, it, expect } from "vitest";
import {
  DELETABLE, DELETABLE_TABLES, specFor, assertReason, describeImpact, MIN_REASON_LEN,
} from "./deletable";
import { MUTATING_TOOLS } from "../ai/tool-bridge";
import { TOOLS } from "./tools";

describe("the whitelist", () => {
  it("never exposes the tables that would let a chat cover its tracks", () => {
    for (const forbidden of ["audit_log", "tenants", "org_members", "profiles", "api_tokens", "app_settings"]) {
      expect(DELETABLE_TABLES).not.toContain(forbidden);
    }
  });

  it("rejects anything not on it, by name, with the allowed list", () => {
    expect(() => specFor("audit_log")).toThrow(/can't be deleted/);
    expect(() => specFor("profiles")).toThrow(/can't be deleted/);
    // the message has to tell the admin what IS allowed
    expect(() => specFor("nope")).toThrow(/payouts/);
  });

  it("covers the tables an import can corrupt", () => {
    expect(DELETABLE_TABLES).toContain("payouts");
    expect(DELETABLE_TABLES).toContain("receipts");
    expect(DELETABLE_TABLES).toContain("recipients");
  });

  it("deleting must go through the confirm gate", () => {
    expect(MUTATING_TOOLS.has("delete_record")).toBe(true);
    // the preview is read-only and must NOT be gated, or it can't inform the decision
    expect(MUTATING_TOOLS.has("preview_delete")).toBe(false);
  });

  it("is hidden from the external MCP server, where nothing would confirm it", () => {
    // The Confirm step IS the safeguard, and it only exists in the chat UI.
    const del = TOOLS.find((t: any) => t.name === "delete_record") as any;
    expect(del).toBeTruthy();
    expect(del.chatOnly).toBe(true);
    // the read-only preview is fine to expose
    const prev = TOOLS.find((t: any) => t.name === "preview_delete") as any;
    expect(prev.chatOnly).toBeFalsy();
  });
});

describe("cascade declarations match the live schema", () => {
  // Read from pg_constraint, not the repo's migrations — three of these are
  // absent from the checked-in SQL and would have been under-reported.
  it("a recipient takes their receipts, photos, testimonials, payouts AND notes", () => {
    const tables = DELETABLE.recipients.cascades.map((c) => c.table).sort();
    expect(tables).toEqual(["payouts", "photos", "receipts", "recipient_notes", "testimonials"]);
  });

  it("an application takes its notes, and is BLOCKED by its recipients", () => {
    expect(DELETABLE.applications.cascades.map((c) => c.table)).toEqual(["application_notes"]);
    expect(DELETABLE.applications.restricts.map((c) => c.table)).toEqual(["recipients"]);
  });

  it("a payout batch destroys nothing — its payouts survive, unlinked", () => {
    expect(DELETABLE.payout_batches.cascades).toEqual([]);
    expect(DELETABLE.payout_batches.unlinks).toEqual([{ table: "payouts", fk: "batch_id" }]);
  });

  it("a payout is a leaf — the common repair, with no collateral", () => {
    expect(DELETABLE.payouts.cascades).toEqual([]);
    expect(DELETABLE.payouts.restricts).toEqual([]);
    expect(DELETABLE.payouts.affectsBalance).toBe(true);
  });

  it("a receipt unlinks its duplicates rather than destroying them", () => {
    expect(DELETABLE.receipts.unlinks).toEqual([{ table: "receipts", fk: "duplicate_of_id" }]);
  });

  it("flags every stored file so a delete can't orphan an object", () => {
    expect(DELETABLE.receipts.storage).toEqual({ bucket: "receipts", column: "image_path" });
    expect(DELETABLE.photos.storage).toEqual({ bucket: "photos", column: "image_path" });
  });

  it("flags the money-affecting deletions", () => {
    expect(DELETABLE.payouts.affectsBalance).toBe(true);
    expect(DELETABLE.receipts.affectsBalance).toBe(true);
    expect(DELETABLE.recipients.affectsBalance).toBe(true);
    expect(DELETABLE.photos.affectsBalance).toBeFalsy();
  });
});

describe("assertReason", () => {
  it("requires a real sentence, not a shrug", () => {
    expect(() => assertReason("")).toThrow(/reason is required/);
    expect(() => assertReason("dup")).toThrow(/reason is required/);
    expect(() => assertReason("   ")).toThrow(/reason is required/);
    expect(() => assertReason(undefined)).toThrow(/reason is required/);
    expect(() => assertReason(42 as any)).toThrow(/reason is required/);
  });
  it("accepts and trims a proper one", () => {
    expect(assertReason("  duplicate from the double import  ")).toBe("duplicate from the double import");
  });
  it("caps the length so it can't flood the audit row", () => {
    expect(assertReason("x".repeat(9000)).length).toBe(500);
  });
  it("keeps the bar low enough to be usable", () => {
    expect(MIN_REASON_LEN).toBeGreaterThan(0);
    expect(MIN_REASON_LEN).toBeLessThanOrEqual(20);
  });
});

describe("describeImpact", () => {
  const counts = (o: Record<string, number>) => o;

  it("reports only the relations that actually have rows", () => {
    const i = describeImpact(DELETABLE.recipients, counts({
      "receipts.recipient_id": 3, "photos.recipient_id": 0,
      "testimonials.recipient_id": 0, "payouts.recipient_id": 2,
      "recipient_notes.recipient_id": 1,
    }));
    expect(i.destroys).toEqual(["3 receipts", "2 payouts", "1 recipient_notes"]);
    expect(i.blockedBy).toEqual([]);
  });

  it("says nothing when the record is clean", () => {
    const i = describeImpact(DELETABLE.payouts, counts({}));
    expect(i.destroys).toEqual([]);
    expect(i.unlinks).toEqual([]);
    expect(i.blockedBy).toEqual([]);
  });

  it("surfaces a DB-level block instead of letting Postgres throw", () => {
    const i = describeImpact(DELETABLE.applications, counts({ "recipients.application_id": 1 }));
    expect(i.blockedBy).toEqual(["1 recipients"]);
  });

  // Counts are keyed table+fk: a table can appear in two relation lists
  // (receipts self-links), and a table-only key would overwrite one.
  it("does not confuse two relations on the same table", () => {
    const i = describeImpact(DELETABLE.receipts, counts({ "receipts.duplicate_of_id": 4 }));
    expect(i.unlinks).toEqual(["4 receipts"]);
    expect(i.destroys).toEqual([]);
  });
});
