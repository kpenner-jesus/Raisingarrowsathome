// Pure-function slug validation extracted so create-org + check-slug routes
// and tests share one source of truth.

export const RESERVED_SLUGS = new Set<string>([
  "admin", "portal", "apply", "auth", "signup", "platform",
  "api", "_next", "static", "public", "o",
  "raising-arrows",
]);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/** Validate a candidate slug WITHOUT checking DB uniqueness. */
export function validateSlug(raw: string): SlugValidation {
  const slug = raw.trim().toLowerCase();
  if (!slug) return { ok: false, reason: "empty" };
  if (slug.length < 3) return { ok: false, reason: "too short — minimum 3 characters" };
  if (!SLUG_RE.test(slug)) return { ok: false, reason: "lowercase letters, digits, hyphens only — must start + end alphanumeric" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: "this URL is reserved — pick another" };
  return { ok: true, slug };
}
