// ============================================================
//  broadcasts.ts — send a broadcast, resumably.
//
//  A broadcast used to be sent in one shot: claim the row, loop every family
//  doing one HTTP call each, write the result at the end. Killed halfway (and
//  a serverless function WILL be killed halfway — this account's ceiling is
//  60s), the row was stranded in state='sending', some families had received
//  it and some hadn't, nothing retried, and pressing Send again re-mailed
//  everyone.
//
//  Now:
//    1. MATERIALIZE the audience once into broadcast_sends. This freezes who
//       is in it — matching what the form promised the operator — and makes
//       "who still needs this" a query rather than a re-derivation. The old
//       recipient query had no ORDER BY and no stable key, so a naive cursor
//       would have skipped or repeated families.
//    2. Send in TIME-BOXED slices under a lease, recording each row's outcome
//       as it goes. An interrupted slice loses at most the row in flight.
//    3. Every send carries a provider Idempotency-Key, so a crash between
//       sending and recording is replayed rather than re-sent - for as long as
//       the provider retains that key (about a day). Past that window, a
//       broadcast stranded and recovered only by the next daily cron could
//       produce at most ONE duplicate, for the single row that was in flight.
//       Resuming promptly avoids it entirely.
//
//  Rate limiting matters here: the provider's default is 2 requests/second and
//  the old loop fired as fast as the network allowed, then recorded every 429
//  as a PERMANENT failure. A slice of every large broadcast was being written
//  off as undeliverable. 429 is now retryable and the loop paces itself.
//
//  Migrations are applied by hand in this project, so all of this degrades:
//  if broadcast_sends doesn't exist yet, we fall back to the old one-shot path
//  and SAY SO in the result rather than pretending resume works.
// ============================================================

import { randomUUID } from "crypto";
import { supabaseService } from "./supabase/server";
import { signToken, signTokenWithExpiry } from "./hmac";
import { envTags } from "./email-env";
import {
  buildLedgerRows, classifyResendOutcome, idempotencyKey,
  unsubExpiryFor, shouldStopSlice, normalizeEmail,
  type LedgerRow,
} from "./broadcast-logic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://raisingarrowsathome.com";

/** How long one slice may run. Deliberately NOT derived from maxDuration:
 *  this account's real ceiling is 60s regardless of what maxDuration says. */
const SLICE_MS = Number(process.env.BROADCAST_SLICE_MS || 20_000);
/** Lease length. DERIVED from the slice budget, never a bare constant: if an
 *  operator raises BROADCAST_SLICE_MS past a fixed lease, the lease expires
 *  mid-slice, a second worker claims the row, and both send the same rows. */
const LEASE_MS = Math.max(120_000, SLICE_MS * 3);
/** Spacing between sends — the provider's default allowance is 2/second. */
const SEND_SPACING_MS = Number(process.env.BROADCAST_SPACING_MS || 600);
/** A row is retried at most this many times before it counts as failed. */
const MAX_ATTEMPTS = 3;
const PAGE = 500;

export interface SliceResult {
  broadcast_id: string;
  done: boolean;
  sent: number;
  failed: number;
  pending: number;
  total: number | null;
  /** Set when we couldn't take the lease — someone else is sending it. */
  skipped?: "locked" | "not_found";
  /** Set when the ledger table isn't there yet. */
  degraded?: "ledger_missing";
  /** Set when the run stopped for a reason retrying won't fix. Clients MUST
   *  stop pumping when they see this. */
  aborted?: "provider_auth";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Does the ledger exist? ───────────────────────────────────

let ledgerReady = false;
let ledgerProbedAt = 0;
const LEDGER_RECHECK_MS = 30_000;
/**
 * Only a POSITIVE result is cached for good. A negative one is re-checked.
 *
 * Caching "missing" for the life of the lambda was wrong and dangerous:
 * migrations in this project are applied BY HAND, often minutes after the
 * deploy. A warm instance that probed before the migration would keep taking
 * the leaseless legacy path afterwards, and that path re-derives the whole
 * audience and mails everyone a second time.
 */
async function hasLedger(): Promise<boolean> {
  if (ledgerReady) return true;
  if (Date.now() - ledgerProbedAt < LEDGER_RECHECK_MS) return false;
  ledgerProbedAt = Date.now();
  const { error } = await supabaseService()
    .from("broadcast_sends").select("broadcast_id", { head: true, count: "exact" }).limit(1);
  // 42P01 = undefined_table. PGRST205 = PostgREST doesn't know the table yet,
  // which is what supabase-js actually returns for a missing table.
  const missing = !!error && ((error as any).code === "42P01" || (error as any).code === "PGRST205");
  if (error && !missing) {
    console.error("[broadcasts] ledger probe failed (treating as present):", error.message);
  }
  ledgerReady = !missing;
  if (missing) console.warn("[broadcasts] broadcast_sends is missing — sends will NOT be resumable until migration 20260617b is applied");
  return ledgerReady;
}

// ── Building the frozen recipient list ───────────────────────

async function loadAudience(orgId: string, audience: string): Promise<LedgerRow[]> {
  const svc = supabaseService();
  const raw: { email: string | null; parent_names?: string | null }[] = [];

  if (audience === "admins") {
    const { data } = await svc
      .from("org_members")
      .select("profiles:profiles!org_members_user_id_fkey(email)")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"])
      .order("user_id");
    for (const r of (data ?? []) as any[]) raw.push({ email: r.profiles?.email, parent_names: "Admin" });
  } else {
    // Keyset-paged and ordered. The old query had neither, so it silently
    // truncated at PostgREST's 1000-row ceiling and returned rows in whatever
    // order the planner felt like.
    let last = "";
    for (;;) {
      let q = svc.from("recipients")
        .select("id, applications!inner(parent_names, contact_email)")
        .eq("org_id", orgId)
        // Archived families were still being mailed. This is a behaviour
        // change, and the counts on the send form are updated to match.
        .is("archived_at", null)
        .order("id")
        .limit(PAGE);
      if (audience === "active_recipients") q = q.eq("status", "active");
      if (last) q = q.gt("id", last);
      const { data, error } = await q;
      if (error) throw new Error(`recipient lookup failed: ${error.message}`);
      const rows = (data ?? []) as any[];
      for (const r of rows) raw.push({ email: r.applications?.contact_email, parent_names: r.applications?.parent_names });
      if (rows.length < PAGE) break;
      last = rows[rows.length - 1].id;
    }
  }

  // Opt-outs, chunked: a single .in() with hundreds of addresses builds a URL
  // long enough to be rejected.
  const emails = raw.map((r) => normalizeEmail(r.email)).filter(Boolean) as string[];
  const opted = new Set<string>();
  for (let i = 0; i < emails.length; i += 100) {
    const { data } = await svc.from("email_optouts")
      .select("email").eq("org_id", orgId).in("email", emails.slice(i, i + 100));
    for (const o of (data ?? []) as any[]) {
      const n = normalizeEmail(o.email);
      if (n) opted.add(n);
    }
  }

  return buildLedgerRows({ rows: raw, optedOut: opted });
}

/**
 * Write the audience into the ledger, then stamp materialized_at.
 *
 * The stamp goes LAST and is the gate: a half-written ledger is otherwise
 * indistinguishable from "fully written, half sent", and we would silently
 * under-send and report success. Upsert-ignore makes a re-run after an
 * interrupted materialization safe — it never clobbers a row already sent.
 */
async function materializeAudience(claimed: any, leaseToken: string): Promise<number> {
  const svc = supabaseService();
  const rows = await loadAudience(claimed.org_id, claimed.audience);

  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((r) => ({
      broadcast_id: claimed.id,
      org_id:       claimed.org_id,
      email:        r.email,
      parent_names: r.parent_names,
      status:       "pending",
    }));
    const { error } = await svc.from("broadcast_sends")
      .upsert(batch, { onConflict: "broadcast_id,email", ignoreDuplicates: true });
    if (error) throw new Error(`could not build the recipient list: ${error.message}`);
  }

  // Fenced like every other write-back: building a large audience can outlive
  // the lease, and an unfenced stamp would land on a broadcast another worker
  // had already finished, rewriting its denominator after the fact.
  const { data: stamped, error: stampErr } = await svc.from("broadcasts")
    .update({ materialized_at: new Date().toISOString(), total_count: rows.length })
    .eq("id", claimed.id).eq("lease_owner", leaseToken).select("id");
  if (stampErr) throw new Error(`could not finalise the recipient list: ${stampErr.message}`);
  if (!stamped || stamped.length === 0) {
    throw new Error("lost the lease while building the recipient list - it will resume");
  }
  return rows.length;
}

// ── Counting, always from the ledger ─────────────────────────

/**
 * Counts straight from the ledger. THROWS on failure — never returns zero.
 *
 * This previously discarded the error and returned `count ?? 0`, which was a
 * silent-skip waiting to happen: a transient failure on the pending count
 * makes pending === 0, the slice concludes it is finished, and the broadcast
 * is marked 'sent' having emailed nobody. Failing loudly leaves the row in
 * 'sending', which is resumable; guessing zero is not recoverable because
 * nothing afterwards knows anything went wrong.
 */
async function ledgerCounts(broadcastId: string) {
  const svc = supabaseService();
  const one = async (status: string) => {
    const { count, error } = await svc.from("broadcast_sends")
      .select("id", { head: true, count: "exact" })
      .eq("broadcast_id", broadcastId).eq("status", status);
    if (error) throw new Error(`could not count ${status} recipients: ${error.message}`);
    return count ?? 0;
  };
  const [sent, failed, pending] = await Promise.all([one("sent"), one("failed"), one("pending")]);
  return { sent, failed, pending };
}

// ── One slice ────────────────────────────────────────────────

export async function runBroadcastSlice(args: {
  broadcastId: string;
  /** Set by the admin path so a tenant can only drive its OWN broadcast. */
  orgId?: string;
  budgetMs?: number;
}): Promise<SliceResult> {
  const svc = supabaseService();
  const started = Date.now();
  const budgetMs = args.budgetMs ?? SLICE_MS;

  if (!(await hasLedger())) {
    const legacy = await sendLegacy({ broadcastId: args.broadcastId });
    return {
      broadcast_id: args.broadcastId, done: true,
      sent: legacy.sent, failed: legacy.failed, pending: 0, total: null,
      degraded: "ledger_missing",
    };
  }

  // Snapshot BEFORE the claim. The claim is an UPDATE ... RETURNING, so its
  // result already carries our own state='sending' and progress_at=now - which
  // is exactly the pair the pre-ledger test below depends on.
  let before = svc.from("broadcasts")
    .select("state, materialized_at, progress_at, total_count")
    .eq("id", args.broadcastId);
  if (args.orgId) before = before.eq("org_id", args.orgId);
  const { data: prior } = await before.maybeSingle();

  // A broadcast from before the ledger existed has NO record of who already
  // received it, so "resuming" it would mail the whole audience a second time.
  // The cron filtered these out and the UI hid the button, but a direct POST
  // reached neither guard - and this is the one place every caller passes
  // through. A brand-new send is inserted as 'queued', and a send interrupted
  // while building its list already has progress_at, so neither is caught here.
  if (prior
      && (prior as any).state !== "queued"
      && (prior as any).total_count == null
      && !(prior as any).materialized_at
      && !(prior as any).progress_at) {
    console.warn("[broadcasts] refusing to resume a pre-ledger broadcast", args.broadcastId);
    return {
      broadcast_id: args.broadcastId, done: true,
      sent: 0, failed: 0, pending: 0, total: null, skipped: "not_found",
    };
  }

  // Take the lease. Single statement, so two workers can't both win: the
  // .or() only matches a free or expired lease.
  const token = randomUUID();
  const now = new Date();
  let claim = svc.from("broadcasts")
    .update({
      state: "sending",
      lease_owner: token,
      lease_expires_at: new Date(now.getTime() + LEASE_MS).toISOString(),
      progress_at: now.toISOString(),
    })
    .eq("id", args.broadcastId)
    // 'sent'/'failed' are included on purpose. Retry-failed puts rows back to
    // pending on a broadcast that already reached a terminal state, and the UI
    // offers Resume for it. Without these the claim could never match, so the
    // button was a permanent no-op and those families were unreachable.
    // Re-entry is safe because the LEDGER decides who gets mail, not the state.
    .in("state", ["queued", "sending", "sent", "failed"])
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`);
  if (args.orgId) claim = claim.eq("org_id", args.orgId);

  const { data: claimed, error: claimErr } = await claim
    .select("id, org_id, subject, body_html, audience, created_at, materialized_at, total_count, progress_at")
    .maybeSingle();
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) {
    // Either someone else holds the lease, or it's already finished.
    const { data: row } = await svc.from("broadcasts")
      .select("id, total_count").eq("id", args.broadcastId).maybeSingle();
    const counts = row ? await ledgerCounts(args.broadcastId) : { sent: 0, failed: 0, pending: 0 };
    return {
      broadcast_id: args.broadcastId, done: !row ? true : counts.pending === 0,
      ...counts, total: (row as any)?.total_count ?? null,
      skipped: row ? "locked" : "not_found",
    };
  }

  const orgId = (claimed as any).org_id as string;
  const release = async (extra: Record<string, any> = {}) => {
    await svc.from("broadcasts")
      .update({ lease_owner: null, lease_expires_at: null, progress_at: new Date().toISOString(), ...extra })
      .eq("id", args.broadcastId)
      .eq("lease_owner", token);   // fencing: never stomp a newer owner
  };
  /** Release WITHOUT refreshing progress_at, so the row reads as stale and the
   *  operator gets a Resume button immediately instead of a 10-minute wait. */
  const releaseKeepingProgress = async () => {
    await svc.from("broadcasts")
      .update({ lease_owner: null, lease_expires_at: null })
      .eq("id", args.broadcastId).eq("lease_owner", token);
  };

  try {
    // Check the environment BEFORE materializing. Aborting afterwards wrote a
    // terminal state over a freshly-built list of pending recipients, and
    // nothing would ever send them.
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM_EMAIL = process.env.RESEND_FROM || "Raising Arrows <register@raisingarrowsathome.com>";
    if (!RESEND_KEY) {
      console.error("[broadcasts] RESEND_API_KEY is not set - nothing sent");
      await release({ state: "failed", sent_at: new Date().toISOString() });
      return { broadcast_id: args.broadcastId, done: true, sent: 0, failed: 0, pending: 0, total: null };
    }
    // CASL / CAN-SPAM: never mass-mail without a working unsubscribe path.
    try { signToken("probe", 60); }
    catch (e: any) {
      console.error("[broadcasts] aborting - HMAC secret missing, cannot sign unsubscribe links:", e?.message ?? e);
      await release({ state: "failed", sent_at: new Date().toISOString() });
      return { broadcast_id: args.broadcastId, done: true, sent: 0, failed: 0, pending: 0, total: null };
    }

    let total = (claimed as any).total_count as number | null;
    if (!(claimed as any).materialized_at) {
      total = await materializeAudience(claimed, token);
    }

    const unsubExpiry = unsubExpiryFor((claimed as any).created_at, Date.now());
    let sentThisSlice = 0;

    for (;;) {
      const { pending } = await ledgerCounts(args.broadcastId);
      const next = shouldStopSlice({ elapsedMs: Date.now() - started, budgetMs, pending });
      if (next !== "send") break;

      const { data: batch } = await svc.from("broadcast_sends")
        .select("id, email, parent_names, attempts")
        .eq("broadcast_id", args.broadcastId).eq("status", "pending")
        .order("id").limit(25);
      if (!batch || batch.length === 0) break;

      // Someone who unsubscribes mid-send must not still receive it. The
      // audience is frozen, but consent is not - so re-check this batch.
      const batchEmails = (batch as any[]).map((r) => r.email);
      const { data: optedNow } = await svc.from("email_optouts")
        .select("email").eq("org_id", orgId).in("email", batchEmails);
      const optedSet = new Set((optedNow ?? []).map((o: any) => String(o.email).toLowerCase()));

      for (const row of batch as any[]) {
        if (Date.now() - started >= budgetMs) break;

        if (optedSet.has(String(row.email).toLowerCase())) {
          await svc.from("broadcast_sends")
            .update({ status: "failed", last_error: "unsubscribed before this was sent" })
            .eq("id", row.id);
          continue;
        }

        const unsubToken = signTokenWithExpiry(`unsub:${orgId}:${row.email}`, unsubExpiry);
        const unsubUrl = `${SITE}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
        const html = (claimed as any).body_html.replaceAll("{{parent_names}}", escapeHtml(row.parent_names || "friend"))
          + `<hr style="border:0;border-top:1px solid #eee;margin:36px 0 12px;">
             <p style="font-size:0.75rem;color:#aaa;margin:0;">
               You're receiving this because you're part of Raising Arrows.
               <a href="${unsubUrl}" style="color:#aaa;">Unsubscribe</a>
             </p>`;

        // Increment BEFORE the request. If we die between sending and
        // recording, the retry is bounded instead of unbounded. The provider's
        // idempotency key covers the duplicate, but only for about a day (see
        // the note at the top of this file).
        const attempts = (row.attempts ?? 0) + 1;
        {
          const { error } = await svc.from("broadcast_sends").update({ attempts }).eq("id", row.id);
          if (error) throw new Error(`could not claim ${row.email}: ${error.message}`);
        }

        let verdict;
        let providerId: string | null = null;
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            // The budget is only checked BETWEEN rows, so one stalled request
            // could run past the platform's hard 60s ceiling and kill the
            // invocation before the lease is released. A timeout turns that
            // into an ordinary retryable network error instead.
            signal: AbortSignal.timeout(8_000),
            headers: {
              Authorization: `Bearer ${RESEND_KEY}`,
              "Content-Type": "application/json",
              // Same key for the same (broadcast, recipient) forever, so a
              // retry after a crash replays rather than sends again.
              "Idempotency-Key": idempotencyKey(args.broadcastId, row.email),
            },
            body: JSON.stringify({
              from: FROM_EMAIL, to: [row.email],
              subject: (claimed as any).subject, html,
              // Marks which environment sent this, so the shared Resend
              // account's webhook can drop foreign events instead of writing
              // them into the wrong database.
              tags: envTags(),
              headers: {
                "List-Unsubscribe":      `<${unsubUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }),
          });
          // Read the body ONCE — a Response body can only be consumed once.
          const raw = await res.text().catch(() => "");
          if (res.ok) { try { providerId = (JSON.parse(raw || "{}") || {}).id ?? null; } catch { /* provider id is optional */ } }
          verdict = classifyResendOutcome({
            status: res.status,
            bodyText: res.ok ? "" : raw,
            retryAfterHeader: res.headers.get("retry-after"),
          });
        } catch (e: any) {
          verdict = classifyResendOutcome({ status: 0, bodyText: e?.message || "network error" });
        }

        const write = async (patch: Record<string, any>) => {
          const { error } = await svc.from("broadcast_sends").update(patch).eq("id", row.id);
          // Discarding this was an unbounded re-send: the row stays pending,
          // the next pass picks the same head-of-queue batch, and the slice
          // burns its whole budget re-mailing the same addresses while the
          // counter sits still.
          if (error) throw new Error(`could not record the result for ${row.email}: ${error.message}`);
        };

        if (verdict.outcome === "sent") {
          await write({ status: "sent", sent_at: new Date().toISOString(), provider_id: providerId, last_error: null });
          sentThisSlice++;
        } else if ((verdict as any).alert) {
          // Our credentials are wrong. Nothing about THIS family is
          // undeliverable, so leave the row pending, and release WITHOUT
          // touching progress_at so the broadcast is resumable the moment the
          // key is fixed rather than reading as "Sending" for ten minutes.
          await write({ last_error: verdict.error });
          console.error("[broadcasts] provider rejected our credentials - stopping this slice");
          await releaseKeepingProgress();
          const c = await ledgerCounts(args.broadcastId);
          // `aborted` is what stops the client pump. Without it the browser
          // just asks for another slice and burns one family per round trip.
          return { broadcast_id: args.broadcastId, done: false, ...c, total, aborted: "provider_auth" };
        } else if (verdict.outcome === "retryable" && attempts < MAX_ATTEMPTS) {
          // Stays pending on purpose - a rate-limited family has NOT failed.
          await write({ last_error: verdict.error });
          if (verdict.retryAfterMs) await sleep(Math.min(verdict.retryAfterMs, 5_000));
        } else {
          await write({ status: "failed", last_error: verdict.error });
        }

        await sleep(SEND_SPACING_MS);
      }

      // Renew the lease so a long slice never loses it mid-flight.
      const { data: renewed } = await svc.from("broadcasts")
        .update({
          progress_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
        })
        .eq("id", args.broadcastId).eq("lease_owner", token).select("id");
      // Zero rows means someone else took over. Carrying on would put two
      // senders on the same head of the queue.
      if (!renewed || renewed.length === 0) {
        console.warn("[broadcasts] lost the lease mid-slice, stopping", args.broadcastId);
        const c = await ledgerCounts(args.broadcastId);
        return { broadcast_id: args.broadcastId, done: false, ...c, total, skipped: "locked" };
      }
    }

    const counts = await ledgerCounts(args.broadcastId);
    const done = counts.pending === 0;
    // Counters are RECOMPUTED from the ledger, never accumulated in memory,
    // so overlapping workers can't corrupt them.
    await release(done
      ? {
          state: counts.sent === 0 && counts.failed > 0 ? "failed" : "sent",
          sent_at: new Date().toISOString(),
          recipient_count: counts.sent,
          failed_count: counts.failed,
        }
      : { recipient_count: counts.sent, failed_count: counts.failed });

    return { broadcast_id: args.broadcastId, done, ...counts, total };
  } catch (e: any) {
    await release();
    throw e;
  }
}

// ── Legacy one-shot path (only when the ledger is missing) ───

async function sendLegacy({ broadcastId }: { broadcastId: string }): Promise<{ sent: number; failed: number }> {
  const svc = supabaseService();
  const { data: claimed } = await svc.from("broadcasts")
    .update({ state: "sending" })
    .eq("id", broadcastId)
    .in("state", ["queued", "sending"])
    .select("id, org_id, subject, body_html, audience")
    .maybeSingle();
  if (!claimed) return { sent: 0, failed: 0 };
  const orgId = (claimed as any).org_id as string;

  const rows = await loadAudience(orgId, (claimed as any).audience).catch(() => [] as LedgerRow[]);
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    await svc.from("broadcasts").update({
      state: "failed", sent_at: new Date().toISOString(), recipient_count: 0, failed_count: rows.length,
    }).eq("id", broadcastId);
    return { sent: 0, failed: rows.length };
  }
  try { signToken("probe", 60); }
  catch {
    await svc.from("broadcasts").update({
      state: "failed", sent_at: new Date().toISOString(), recipient_count: 0, failed_count: rows.length,
    }).eq("id", broadcastId);
    return { sent: 0, failed: rows.length };
  }

  const FROM_EMAIL = process.env.RESEND_FROM || "Raising Arrows <register@raisingarrowsathome.com>";
  let sent = 0, failed = 0;
  for (const r of rows) {
    const unsubToken = signToken(`unsub:${orgId}:${r.email}`, 60 * 60 * 24 * 365);
    const unsubUrl = `${SITE}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const html = (claimed as any).body_html.replaceAll("{{parent_names}}", escapeHtml(r.parent_names))
      + `<hr style="border:0;border-top:1px solid #eee;margin:36px 0 12px;">
         <p style="font-size:0.75rem;color:#aaa;margin:0;">
           You're receiving this because you're part of Raising Arrows.
           <a href="${unsubUrl}" style="color:#aaa;">Unsubscribe</a>
         </p>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL, to: [r.email], subject: (claimed as any).subject, html,
          tags: envTags(),
          headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
      });
      if (res.ok) sent++; else failed++;
    } catch { failed++; }
    await sleep(SEND_SPACING_MS);
  }

  await svc.from("broadcasts").update({
    state: failed > 0 && sent === 0 ? "failed" : "sent",
    sent_at: new Date().toISOString(), recipient_count: sent, failed_count: failed,
  }).eq("id", broadcastId).eq("org_id", orgId);
  return { sent, failed };
}

/** Back-compat entry point: send one broadcast to completion in this call. */
export async function sendBroadcast({ broadcastId }: { broadcastId: string }): Promise<{ sent: number; failed: number; state: "sent" | "failed" }> {
  const r = await runBroadcastSlice({ broadcastId });
  return { sent: r.sent, failed: r.failed, state: r.failed > 0 && r.sent === 0 ? "failed" : "sent" };
}

/**
 * Cron entry point: scheduled broadcasts whose time has come, PLUS ones that
 * were interrupted and left stranded.
 *
 * The stranded half is new — the old query only looked for 'queued', which is
 * why nothing ever retried. materialized_at is required so pre-ledger rows are
 * never auto-resumed: they have no record of who already received them, so
 * "resuming" one would re-mail everyone.
 */
export async function sendDueBroadcasts(opts: { totalBudgetMs?: number } = {}): Promise<{ id: string; sent: number; failed: number; done: boolean }[]> {
  const svc = supabaseService();
  const started = Date.now();
  const budget = opts.totalBudgetMs ?? 40_000;
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 10 * 60_000).toISOString();

  const [{ data: due }, { data: stranded }] = await Promise.all([
    svc.from("broadcasts").select("id").eq("state", "queued").lte("scheduled_for", nowIso),
    (await hasLedger())
      ? svc.from("broadcasts").select("id")
          .eq("state", "sending")
          // No materialized_at filter: a broadcast killed while BUILDING its
          // recipient list has none, has emailed nobody, and would otherwise
          // never be picked up at all. Pre-ledger rows stay excluded by the
          // progress_at test below - they have NULL there, and NULL never
          // satisfies `lt`, which is what keeps them from being auto-resumed.
          .lt("progress_at", staleIso)
          .or(`lease_expires_at.is.null,lease_expires_at.lt.${nowIso}`)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const ids = Array.from(new Set([...(due ?? []), ...(stranded ?? [])].map((b: any) => b.id)));
  const out: { id: string; sent: number; failed: number; done: boolean }[] = [];
  for (const id of ids) {
    // This shares its invocation with the backup and payout jobs, so stop
    // before eating the whole budget.
    if (Date.now() - started > budget) break;
    try {
      // Keep slicing THIS broadcast while budget remains. One slice per cron
      // run would mean one slice per DAY - a few hundred families would have
      // taken a fortnight, with nothing saying so.
      let r = await runBroadcastSlice({ broadcastId: id, budgetMs: Math.min(SLICE_MS, budget - (Date.now() - started)) });
      while (!r.done && !r.skipped && !r.aborted && Date.now() - started < budget) {
        r = await runBroadcastSlice({ broadcastId: id, budgetMs: Math.min(SLICE_MS, budget - (Date.now() - started)) });
      }
      out.push({ id, sent: r.sent, failed: r.failed, done: r.done });
    } catch (e: any) {
      console.error("[broadcasts] slice failed for", id, e?.message || e);
    }
  }
  return out;
}
