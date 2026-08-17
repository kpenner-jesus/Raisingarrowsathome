// ============================================================
//  broadcast-logic.ts — the decidable parts of sending a broadcast,
//  as pure functions with no IO.
//
//  Same convention as billing-reminder-logic.ts: the rules live here and are
//  unit-tested; broadcasts.ts is a thin shell that does the database and HTTP
//  work. This matters because the vitest harness is node-only with no
//  Supabase double, so anything left inside the IO shell is untestable.
// ============================================================

import { createHash } from "crypto";

// ── Recipient list ───────────────────────────────────────────

export interface RawRecipient { email: string | null | undefined; parent_names?: string | null }
export interface LedgerRow    { email: string; parent_names: string }

/** Trim + lowercase, or null if it isn't a usable address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.startsWith("@") || e.endsWith("@")) return null;
  if (/\s/.test(e)) return null;
  return e;
}

/**
 * Turn a raw recipient list into the rows to freeze into the ledger.
 *
 * Dedupes by email, which the live query never did: recipients is unique on
 * application_id, not on email, so two applications sharing a contact address
 * (sibling cohorts) each got their own copy of every broadcast.
 */
export function buildLedgerRows(args: {
  rows: RawRecipient[];
  optedOut: Iterable<string>;
}): LedgerRow[] {
  const opted = new Set<string>();
  for (const e of Array.from(args.optedOut)) {
    const n = normalizeEmail(e);
    if (n) opted.add(n);
  }
  const byEmail = new Map<string, LedgerRow>();
  for (const r of args.rows) {
    const email = normalizeEmail(r.email);
    if (!email || opted.has(email)) continue;
    if (byEmail.has(email)) continue;                   // first name wins
    byEmail.set(email, { email, parent_names: (r.parent_names ?? "").trim() || "friend" });
  }
  return Array.from(byEmail.values()).sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
}

// ── Provider outcomes ────────────────────────────────────────

export type SendOutcome =
  | { outcome: "sent" }
  | { outcome: "retryable"; retryAfterMs?: number; error: string }
  | { outcome: "permanent"; error: string; alert?: boolean };

/**
 * Classify a Resend response.
 *
 * The important case is 429. Resend's default is 2 requests/second and the old
 * loop fired as fast as the network allowed, recording every rate-limit
 * rejection as a PERMANENT failure — so a chunk of every large broadcast was
 * quietly written off as undeliverable. A 429 must leave the row pending.
 */
export function classifyResendOutcome(args: {
  status: number;
  bodyText?: string;
  retryAfterHeader?: string | null;
}): SendOutcome {
  const { status } = args;
  const body = (args.bodyText ?? "").slice(0, 300);
  if (status >= 200 && status < 300) return { outcome: "sent" };

  // status 0 = the request never completed (DNS, socket, abort). That is a
  // transient network condition, not a rejected email — it must not burn the
  // recipient as undeliverable.
  if (status <= 0) return { outcome: "retryable", error: body || "network error" };

  if (status === 429) {
    const secs = Number(args.retryAfterHeader);
    return {
      outcome: "retryable",
      retryAfterMs: Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined,
      error: `rate limited${body ? `: ${body}` : ""}`,
    };
  }
  if (status >= 500) return { outcome: "retryable", error: `provider error ${status}${body ? `: ${body}` : ""}` };
  // An auth/config problem shouldn't burn an attempt on all 300 rows before
  // anyone notices, so it is flagged for the caller to abort the whole run.
  if (status === 401 || status === 403) {
    return { outcome: "permanent", error: `not authorised (${status}) — check RESEND_API_KEY`, alert: true };
  }
  return { outcome: "permanent", error: `rejected (${status})${body ? `: ${body}` : ""}` };
}

// ── Idempotency + deterministic unsubscribe expiry ───────────

/**
 * Provider-side idempotency key. Hashed because Resend caps the header at 256
 * characters and an email address can be 320 on its own.
 */
export function idempotencyKey(broadcastId: string, email: string): string {
  const h = createHash("sha256").update(`${broadcastId}:${email.toLowerCase()}`).digest("hex");
  return `bc-${broadcastId}-${h.slice(0, 32)}`.slice(0, 250);
}

/**
 * Absolute expiry for the unsubscribe token, derived from the broadcast's own
 * created_at rather than "now + a year".
 *
 * This is what makes the idempotency key actually work: the old token embedded
 * Date.now(), so a retry produced DIFFERENT html for the same recipient, and a
 * provider that is handed a reused key with a changed payload rejects it
 * instead of deduping.
 */
export function unsubExpiryFor(createdAtIso: string | null | undefined, fallbackNowMs: number): number {
  const base = createdAtIso ? Date.parse(createdAtIso) : NaN;
  const ms = Number.isFinite(base) ? base : fallbackNowMs;
  return Math.floor(ms / 1000) + 60 * 60 * 24 * 365;
}

// ── Slice control ────────────────────────────────────────────

export function shouldStopSlice(args: {
  elapsedMs: number;
  budgetMs: number;
  pending: number;
}): "send" | "stop_budget" | "done" {
  if (args.pending <= 0) return "done";
  if (args.elapsedMs >= args.budgetMs) return "stop_budget";
  return "send";
}

// ── What the operator sees ───────────────────────────────────

export interface BroadcastStatusInput {
  state: string;
  materialized_at?: string | null;
  progress_at?: string | null;
  scheduled_for?: string | null;
  total?: number | null;
  sent: number;
  failed: number;
  pending: number;
  nowMs: number;
  staleAfterMs?: number;
}

export interface BroadcastStatus {
  label: string;
  tone: "neutral" | "progress" | "good" | "warn" | "bad";
  canResume: boolean;
  canRetryFailed: boolean;
  percent: number | null;
  isLegacy: boolean;
}

/**
 * Derive what to show, and whether Resume is safe.
 *
 * Every "is this stranded?" judgement in the app goes through here, so it is
 * the highest-value thing to have tested. Note isLegacy: a broadcast sent
 * before the ledger existed has no record of who received it, so Resume must
 * never be offered for it — that would re-mail everyone.
 */
export function deriveBroadcastStatus(i: BroadcastStatusInput): BroadcastStatus {
  const staleAfter = i.staleAfterMs ?? 10 * 60 * 1000;
  // "Pre-ledger" cannot be inferred from a missing total alone: a broadcast
  // that is still BUILDING its recipient list also has no total yet. The
  // distinguisher is progress_at — the old code never wrote it, the new code
  // stamps it the moment it takes the lease.
  const isLegacy = i.total == null && !i.materialized_at && !i.progress_at;
  const total = i.total ?? 0;
  const percent = isLegacy || total === 0 ? null : Math.round((i.sent / total) * 100);
  const progressMs = i.progress_at ? Date.parse(i.progress_at) : NaN;
  const stale = !Number.isFinite(progressMs) || i.nowMs - progressMs > staleAfter;

  if (i.state === "queued") {
    const when = i.scheduled_for ? Date.parse(i.scheduled_for) : NaN;
    if (Number.isFinite(when) && when > i.nowMs) {
      return { label: "Scheduled", tone: "neutral", canResume: false, canRetryFailed: false, percent, isLegacy };
    }
    return { label: "Waiting to send", tone: "neutral", canResume: !isLegacy, canRetryFailed: false, percent, isLegacy };
  }

  if (i.state === "sending") {
    if (isLegacy) {
      // Pre-ledger and interrupted. Read-only on purpose.
      return { label: "Interrupted (before resume existed)", tone: "warn", canResume: false, canRetryFailed: false, percent: null, isLegacy };
    }
    if (!i.materialized_at) {
      return { label: "Preparing", tone: "progress", canResume: stale, canRetryFailed: false, percent, isLegacy };
    }
    if (stale) {
      return { label: "Paused", tone: "warn", canResume: true, canRetryFailed: i.failed > 0, percent, isLegacy };
    }
    return { label: "Sending", tone: "progress", canResume: false, canRetryFailed: false, percent, isLegacy };
  }

  // Terminal states — but "sent" with rows still pending is not really done.
  if (i.pending > 0 && !isLegacy) {
    return { label: "Incomplete", tone: "warn", canResume: true, canRetryFailed: i.failed > 0, percent, isLegacy };
  }
  if (i.state === "failed") {
    return { label: "Failed", tone: "bad", canResume: false, canRetryFailed: !isLegacy && i.failed > 0, percent, isLegacy };
  }
  if (i.failed > 0) {
    return { label: "Sent, some failed", tone: "warn", canResume: false, canRetryFailed: !isLegacy, percent, isLegacy };
  }
  return { label: "Sent", tone: "good", canResume: false, canRetryFailed: false, percent, isLegacy };
}
