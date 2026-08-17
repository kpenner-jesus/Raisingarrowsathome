// ============================================================
//  submit-throttle-logic.ts — the decidable half of the public
//  application funnel's rate limiter.
//
//  Pure functions only: no Supabase, no Request, no env reads
//  except through an explicitly passed object. The IO shell lives
//  in submit-throttle.ts. Same split as broadcast-logic.ts, for
//  the same reason — anything left inside the IO shell can't be
//  tested by the vitest suite.
// ============================================================

import { createHmac } from "crypto";

export type ThrottleScope = "ip_hour" | "ip_day" | "email_day" | "org_day";

export interface BucketSpec {
  scope:    ThrottleScope;
  key:      string;   // HMAC hex — NEVER a raw IP or email address
  limit:    number;
  window_s: number;
}

/** One row as returned by the application_submit_throttle RPC. */
export interface ThrottleRow {
  out_scope:     string;
  hits:          number | null;
  lim:           number | null;
  allowed:       boolean;
  retry_after_s: number | null;
  evaluated:     boolean;
}

export type ThrottleVerdict =
  | { action: "allow" }
  | { action: "reject"; scope: ThrottleScope; retryAfterS: number; message: string }
  | { action: "accept_no_email"; scope: "org_day" };

export interface Limits {
  ipHour:   number;
  ipDay:    number;
  emailDay: number;
  orgDay:   number;
}

// ── Limits ──────────────────────────────────────────────────

const DEFAULTS: Limits = {
  // Deliberately loose. A homeschool info night in a church basement, a public
  // library, a rural WISP or any mobile carrier collapses many real families
  // onto one address — so IP is the bucket where false positives live, and it
  // must never be the only signal.
  ipHour: 8,
  ipDay: 20,
  // Tight, because email is what costs money and what damages the sending
  // domain. A mail-bomb aimed at one address reuses that address, so this is
  // the bucket that catches it. Three still allows a family to fat-finger and
  // resubmit twice.
  emailDay: 3,
  // The only bucket an attacker with many IPs and many addresses cannot route
  // around, and so the only one that actually bounds spend. 40 x 2 emails = 80,
  // inside Resend's 100/day free tier with headroom for the day's admin mail.
  orgDay: 40,
};

function positiveIntOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Read the four limits from env, falling back to the defaults above. */
export function parseLimits(env: Record<string, string | undefined>): Limits {
  return {
    ipHour:   positiveIntOr(env.APPLY_RL_IP_HOUR,   DEFAULTS.ipHour),
    ipDay:    positiveIntOr(env.APPLY_RL_IP_DAY,    DEFAULTS.ipDay),
    emailDay: positiveIntOr(env.APPLY_RL_EMAIL_DAY, DEFAULTS.emailDay),
    orgDay:   positiveIntOr(env.APPLY_RL_ORG_DAY,   DEFAULTS.orgDay),
  };
}

// ── IP normalisation ────────────────────────────────────────

function isPrivateV4(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0 || a === 127) return true;               // this-network, loopback
  if (a === 10) return true;                           // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16/12
  if (a === 192 && b === 168) return true;             // 192.168/16
  if (a === 169 && b === 254) return true;             // link-local
  if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64/10 CGNAT hop
  return false;
}

function normalizeV4(s: string): string | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const o: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    o.push(n);
  }
  if (isPrivateV4(o)) return null;
  return o.join(".");
}

/**
 * Expand an IPv6 address to its 8 hextets, or null if it isn't one.
 * Handles `::` compression and a trailing IPv4-mapped tail.
 */
function expandV6(s: string): number[] | null {
  let text = s;
  let tail: number[] | null = null;

  // ::ffff:1.2.3.4 — the last chunk is dotted-quad, worth 2 hextets.
  const lastColon = text.lastIndexOf(":");
  if (lastColon >= 0 && text.slice(lastColon + 1).includes(".")) {
    const v4 = text.slice(lastColon + 1).split(".");
    if (v4.length !== 4) return null;
    const o: number[] = [];
    for (const p of v4) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const n = Number(p);
      if (n > 255) return null;
      o.push(n);
    }
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    text = text.slice(0, lastColon + 1) + "0:0";
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const toHextets = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const h of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };

  const left = toHextets(halves[0]);
  if (left === null) return null;

  let full: number[];
  if (halves.length === 1) {
    full = left;
  } else {
    const right = toHextets(halves[1]);
    if (right === null) return null;
    const fill = 8 - (left.length + right.length);
    if (fill < 1) return null;   // `::` must stand for at least one group
    full = [...left, ...new Array(fill).fill(0), ...right];
  }
  if (full.length !== 8) return null;

  // Re-seat the IPv4 tail we substituted above.
  if (tail) { full[6] = tail[0]; full[7] = tail[1]; }
  return full;
}

/**
 * Reduce a client address to a stable, countable identity — or null when it
 * is not a usable public address and the IP buckets should be skipped.
 *
 * IPv6 is truncated to its /64 PREFIX. A household is handed a whole /64 and
 * can rotate the low 64 bits at will, so counting full addresses would be
 * evaded by picking a new one for every request. (Some ISPs delegate /56 or
 * /48; /64 is the standard tradeoff and errs toward not over-blocking.)
 *
 * IPv4-mapped v6 (`::ffff:1.2.3.4`) collapses to the plain v4 form, or the
 * same host would count as two separate identities.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;

  // [2001:db8::1]:443 → 2001:db8::1
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close < 0) return null;
    s = s.slice(1, close);
  } else if (s.split(":").length === 2 && s.includes(".")) {
    // 1.2.3.4:5678 → 1.2.3.4  (exactly one colon, so not v6)
    s = s.split(":")[0];
  }
  if (!s) return null;

  if (!s.includes(":")) return normalizeV4(s);

  const h = expandV6(s);
  if (!h) return null;

  // IPv4-mapped (::ffff:a.b.c.d) — treat as the v4 address it really is.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return normalizeV4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join("."));
  }

  if (h.every((x) => x === 0)) return null;                       // ::
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 &&
      h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1) return null;  // ::1
  if ((h[0] & 0xfe00) === 0xfc00) return null;                    // fc00::/7 unique-local
  if ((h[0] & 0xffc0) === 0xfe80) return null;                    // fe80::/10 link-local

  return h.slice(0, 4).map((x) => x.toString(16)).join(":") + "::/64";
}

/**
 * Pull the client address out of the request headers.
 *
 * `trustProxy` MUST be false anywhere the app is not behind Vercel's edge:
 * off-platform, x-forwarded-for is set by the caller, so enforcing an IP limit
 * on it would be theatre. Returning null there skips the IP buckets honestly
 * instead of pretending to have a control we don't.
 */
export function pickClientIp(
  headers: Record<string, string | null | undefined>,
  opts: { trustProxy: boolean },
): string | null {
  if (!opts.trustProxy) return null;
  const get = (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null;

  // x-vercel-forwarded-for is rewritten at the edge and is not client-settable.
  const candidates = [
    get("x-vercel-forwarded-for"),
    get("x-real-ip"),
    (get("x-forwarded-for") ?? "").split(",")[0],   // leftmost hop only
  ];
  for (const c of candidates) {
    const ip = normalizeIp(c);
    if (ip) return ip;
  }
  return null;
}

// ── Bucket keys ─────────────────────────────────────────────

/**
 * Keyed hash of an identifier. NEVER store the raw value.
 *
 * An IP address is personal information under PIPEDA, and here it sits one
 * join away from a named family with children. HMAC rather than a plain
 * digest because IPv4 is only 2^32 values — a bare SHA-256 of an IP is a
 * rainbow table you can build in seconds. Including the scope in the preimage
 * keeps an address that looks like an email from colliding across buckets.
 */
export function bucketKey(secret: string, scope: string, value: string): string {
  return createHmac("sha256", secret).update(`${scope}:${value}`).digest("hex");
}

/** Lower-case + trim an email so casing doesn't mint a fresh budget. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return s.includes("@") ? s : null;
}

/**
 * Assemble the buckets to evaluate, in PRECEDENCE order. The RPC stops
 * counting after the first denial, so cheapest/broadest signals go first and
 * the org breaker goes last — otherwise a flood aimed at one IP would also
 * burn the email budget of whatever address it carried and lock the real
 * owner of that address out of the funnel for a day.
 */
export function buildBuckets(input: {
  secret: string;
  ip:     string | null;
  email:  string | null;
  orgId:  string;
  limits: Limits;
}): BucketSpec[] {
  const { secret, ip, email, orgId, limits } = input;
  const out: BucketSpec[] = [];

  if (ip) {
    out.push({ scope: "ip_hour", key: bucketKey(secret, "ip", ip), limit: limits.ipHour, window_s: 3600 });
    out.push({ scope: "ip_day",  key: bucketKey(secret, "ip", ip), limit: limits.ipDay,  window_s: 86400 });
  }
  if (email) {
    out.push({ scope: "email_day", key: bucketKey(secret, "email", email), limit: limits.emailDay, window_s: 86400 });
  }
  // Always present: it is the backstop that bounds spend when the others are
  // skipped or evaded.
  out.push({ scope: "org_day", key: bucketKey(secret, "org", orgId), limit: limits.orgDay, window_s: 86400 });
  return out;
}

// ── The verdict ─────────────────────────────────────────────

const REJECT_COPY: Record<string, string> = {
  ip_hour:
    "We've had a burst of submissions from your network, so we couldn't accept this one just yet. " +
    "Please wait a little while and press Submit again — your answers are still here.",
  ip_day:
    "We've had a lot of submissions from your network today, so we couldn't accept this one. " +
    "Please try again tomorrow, or email us and we'll take your application by hand.",
  email_day:
    "We already have an application from this email address. Check your inbox for your reference " +
    "number — if you meant to send a correction, reply to that email instead and we'll update it for you.",
};

/**
 * Turn the RPC's rows into what the route should do.
 *
 * Fails OPEN on missing/empty rows: that is what an RPC error or a
 * not-yet-applied migration looks like, and turning real families away is
 * worse than letting a burst through. See submit-throttle.ts for why that
 * trade is defensible rather than lazy.
 */
export function decideThrottle(rows: ThrottleRow[] | null | undefined): ThrottleVerdict {
  if (!Array.isArray(rows) || rows.length === 0) return { action: "allow" };

  const denied = rows.find((r) => r && r.evaluated && !r.allowed);
  if (!denied) return { action: "allow" };

  const scope = denied.out_scope as ThrottleScope;

  // The org breaker must NOT reject. At this tier an attack and a
  // school-announcement stampede look identical, and the asymmetry is total:
  // a lost application is unrecoverable, a missing confirmation email is not.
  // Save the row, skip the mail.
  if (scope === "org_day") return { action: "accept_no_email", scope: "org_day" };

  return {
    action: "reject",
    scope,
    retryAfterS: Math.max(1, Number(denied.retry_after_s) || 60),
    message: REJECT_COPY[scope] ?? REJECT_COPY.ip_hour,
  };
}

// ── Cheap, zero-IO defences ─────────────────────────────────
//
// These keep working when Postgres is unreachable, which is exactly when the
// limiter isn't. They are what makes failing open defensible.

/** Max distinct keys in the `answers` object. */
export const MAX_ANSWER_KEYS = 40;

export function answerKeyCountOk(
  answers: unknown,
  max: number = MAX_ANSWER_KEYS,
): boolean {
  if (typeof answers !== "object" || answers === null) return false;
  return Object.keys(answers as Record<string, unknown>).length <= max;
}

/**
 * A hidden field no human can see and no real browser fills in. Bots that
 * parse the form and populate every input trip it.
 */
export const HONEYPOT_FIELD = "company_website";

export function isHoneypotTripped(body: Record<string, unknown> | null | undefined): boolean {
  const v = body?.[HONEYPOT_FIELD];
  return typeof v === "string" && v.trim().length > 0;
}
