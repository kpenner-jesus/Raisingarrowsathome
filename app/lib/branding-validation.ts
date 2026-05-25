// Pure-function branding validators extracted from /api/admin/branding
// so tests + future MCP tools can share one source of truth.

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Strict 6-digit hex like "#e8793a". Empty string rejected. */
export function validateBrandColor(raw: unknown): ValidationResult<string> {
  if (typeof raw !== "string") return { ok: false, reason: "brand_color must be a string" };
  const v = raw.trim();
  if (!HEX_RE.test(v)) return { ok: false, reason: "brand_color must be a 6-digit hex (e.g. #e8793a)" };
  return { ok: true, value: v };
}

/** https-only URL or null/empty (which means "clear"). */
export function validateLogoUrl(raw: unknown): ValidationResult<string | null> {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, reason: "logo_url must be a string or null" };
  const v = raw.trim();
  if (v.length === 0) return { ok: true, value: null };
  if (!/^https:\/\//i.test(v)) {
    return { ok: false, reason: "logo_url must start with https:// (http:// is blocked on secure pages)" };
  }
  return { ok: true, value: v };
}
