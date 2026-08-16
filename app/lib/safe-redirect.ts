// ============================================================
//  safe-redirect.ts — one definition of "is this `next` value safe".
//
//  There were three hand-rolled copies of this check (auth callback,
//  login page, middleware) and the strictest of them was still bypassable:
//
//    next = "/\t//evil.com"
//
//  starts with "/", isn't "//", has no scheme and no backslash — so every
//  guard passed. Then `new URL(next, origin)` STRIPS the tab before parsing
//  (WHATWG rule), leaving "///evil.com", which resolves to https://evil.com.
//  Verified: tab, newline and carriage return all escape off-site.
//
//  On a magic-link product that is a phishing redirect served from the real
//  sign-in URL, so this file is deliberately paranoid:
//
//    1. Reject control characters BEFORE any parsing.
//    2. Apply the structural rules.
//    3. Parse, and re-check that the result is still same-origin — so a
//       parser quirk we haven't thought of still can't get out.
// ============================================================

/** Structural check on a raw `next` value. Does not parse. */
export function isSafeRelativePath(raw: string | null | undefined): boolean {
  if (!raw) return false;

  // Control characters first: URL parsing removes tab/LF/CR, so any check
  // performed before that removal is reasoning about a different string
  // than the one the browser will be sent to.
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 32 || c === 127) return false;
  }

  if (!raw.startsWith("/")) return false;   // must be site-relative
  if (raw.startsWith("//")) return false;   // protocol-relative → other host
  if (raw.includes("\\")) return false;     // some parsers treat \ as /
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false; // any scheme
  return true;
}

/**
 * Resolve `next` against `origin`, returning an absolute URL that is
 * GUARANTEED same-origin, or the fallback when it isn't.
 *
 * Use this instead of `new URL(next, origin)` at every redirect site.
 */
export function safeRedirectUrl(
  raw: string | null | undefined,
  origin: string,
  fallback = "/",
): URL {
  const fb = () => new URL(fallback, origin);
  if (!isSafeRelativePath(raw)) return fb();
  let candidate: URL;
  try {
    candidate = new URL(raw as string, origin);
  } catch {
    return fb();
  }
  // Belt and braces: whatever the parser did, refuse to leave this origin.
  try {
    if (candidate.origin !== new URL(origin).origin) return fb();
  } catch {
    return fb();
  }
  return candidate;
}

/** The safe path+query to store in a `next=` parameter, or null. */
export function safeNextParam(raw: string | null | undefined): string | null {
  return isSafeRelativePath(raw) ? (raw as string) : null;
}
