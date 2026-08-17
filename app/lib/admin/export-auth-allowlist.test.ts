// ============================================================
//  The paused/canceled tenant gate is deliberately skipped by
//  requireAdminForDataExport. This test pins WHICH routes are
//  allowed to do that.
//
//  If you are here because CI failed: adding a route to the list
//  below is a conscious decision, not a formality. The question to
//  answer is "does this route only READ the tenant's own data?" If
//  it writes anything, it must use requireAdmin() instead.
// ============================================================

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "app", "api");

/**
 * Drop comments before searching. Naming the helper in a comment — "use
 * requireAdmin, NOT requireAdminForDataExport" — is exactly the sort of note
 * worth writing, and a plain substring search would flag the file that says
 * it. The test must key off what the code DOES, not what it mentions.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** True when the file actually CALLS the relaxed helper. */
function callsRelaxedGate(src: string): boolean {
  return /\brequireAdminForDataExport\s*\(/.test(stripComments(src));
}

/** Every route file that calls the relaxed helper, repo-relative, sorted. */
function routesUsingRelaxedGate(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (callsRelaxedGate(fs.readFileSync(full, "utf8"))) {
        found.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
      }
    }
  };
  walk(API_ROOT);
  return found.sort();
}

const ALLOWED = [
  "app/api/admin/exports/[kind]/route.ts",
  "app/api/admin/exports/photos.zip/route.ts",
].sort();

describe("requireAdminForDataExport allow-list", () => {
  it("is used by exactly the routes we intend", () => {
    expect(routesUsingRelaxedGate()).toEqual(ALLOWED);
  });

  it("is NOT used by the payout-batch export, which writes", () => {
    // That route flips payout_batches.status draft -> exported and stamps
    // exported_at. It is a tenant mutation wearing an export's name, so a
    // paused tenant must still get 423 from it. This is the single most
    // likely wrong-looking "inconsistency" for someone to tidy up later.
    const p = "app/api/admin/payouts/[id]/export/route.ts";
    const src = stripComments(fs.readFileSync(path.join(process.cwd(), p), "utf8"));
    expect(callsRelaxedGate(src)).toBe(false);
    expect(/\brequireAdmin\s*\(/.test(src)).toBe(true);
    // And it really does write, which is why.
    expect(src).toContain('"exported"');
  });

  it("still routes both helpers through the same identity checks", () => {
    // The relaxed helper must not grow its own copy of the role logic.
    const src = fs.readFileSync(
      path.join(process.cwd(), "app", "lib", "admin", "require-admin.ts"), "utf8");
    const relaxed = src.slice(src.indexOf("export async function requireAdminForDataExport"));
    expect(relaxed).toContain("resolveAdminIdentity()");
    expect(relaxed).not.toContain("org_members");
    expect(relaxed).not.toContain("isTenantAccessBlocked");
  });
});
