// ============================================================
//  Storage path helpers — tenant-aware layout for shared buckets.
//
//  Single layout in the receipts/photos buckets:
//    <user_uuid>/<org_uuid>/<random>.<ext>   (3 segments)
//
//  Storage RLS still requires the FIRST segment to equal auth.uid()
//  (see supabase/migrations/001_init.sql), so the user_uuid prefix
//  stays put. The org_uuid wedged in as the second segment encodes
//  "this belongs to tenant X" directly in the path, so signers can
//  refuse a path whose tenant segment doesn't match the caller's org
//  — independent of the DB row's org_id (defence-in-depth).
//
//  Pre-cutover state had legacy 2-segment paths (<user>/<file>). We
//  verified zero such objects + zero referencing rows existed in
//  prod before tightening; legacy is no longer accepted. If a legacy
//  object somehow re-appears it will fail validation/signing — re-
//  upload under the new layout.
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build a new-layout upload path. `fileBase` is the random id + ext. */
export function buildTenantUploadPath(userId: string, orgId: string, fileBase: string): string {
  return `${userId}/${orgId}/${fileBase}`;
}

/**
 * Validate a portal-supplied image_path string.
 *  - Exactly 3 segments: <userId>/<orgId>/<fileBase>.
 *  - First segment MUST equal userId (matches storage RLS first-folder check).
 *  - Second segment MUST be a UUID equal to orgId (case-insensitive).
 *  - Rejects path traversal, backslashes, NULs, and anything else.
 */
export function validatePortalUploadPath(
  path: unknown,
  userId: string,
  orgId: string,
): { ok: true } | { ok: false; error: string } {
  if (typeof path !== "string" || !path) return { ok: false, error: "image_path required" };
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    return { ok: false, error: "invalid image_path" };
  }
  const parts = path.split("/");
  if (parts.length !== 3) {
    return { ok: false, error: "image_path must have layout <user_id>/<org_id>/<file>" };
  }
  if (parts[0] !== userId) {
    return { ok: false, error: "image_path must be inside your own folder" };
  }
  if (!UUID_RE.test(parts[1])) {
    return { ok: false, error: "invalid image_path tenant segment" };
  }
  if (parts[1].toLowerCase() !== orgId.toLowerCase()) {
    return { ok: false, error: "image_path tenant segment does not match your org" };
  }
  return { ok: true };
}

/**
 * Defence-in-depth guard for signed-URL handlers: throws when a path's
 * embedded tenant segment doesn't match the caller's org, OR when the
 * path doesn't follow the <user>/<org>/<file> layout at all.
 *
 * Use after the row has been fetched with .eq("org_id", ctx.org_id);
 * a mismatch here means somebody mutated image_path to point at another
 * tenant's file after the row was created — bail loudly.
 */
export function assertPathBelongsToOrg(path: string, orgId: string): void {
  const parts = path.split("/");
  if (parts.length !== 3) {
    throw new Error("storage path layout is invalid (expected <user>/<org>/<file>)");
  }
  if (!UUID_RE.test(parts[1]) || parts[1].toLowerCase() !== orgId.toLowerCase()) {
    throw new Error("storage path does not belong to this tenant");
  }
}
