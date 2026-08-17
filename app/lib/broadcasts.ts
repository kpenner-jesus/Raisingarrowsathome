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
//    3. Every send carries a provider Idempotency-Key, so even a crash between
//       sending and recording can't produce a second email.
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
import {
  buildLedgerRows, classifyResendOutcome, idempotencyKey,
  unsubExpiryFor, shouldStopSlice, normalizeEmail,
  type LedgerRow,
} from "./broadcast-logic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://raisingarrowsathome.com";

/** How long one slice may run. Deliberately NOT derived from maxDuration:
 *  this account's real ceiling is 60s regardless of what maxDuration says. */
const SLICE_MS = Number(process.env.BROADCAST_SLICE_MS || 20_000);
/** Lease length. Longer than a slice so a slow slice never loses its lease. */
const LEASE_MS = 120_000;
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
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Does the ledger exist? ───────────────────────────────────

let ledgerReady: boolean | null = null;
/** Memoized for the life of the lambda, which is the right TTL: a migration
 *  lands between deploys, not between requests. */
async function hasLedger(): Promise<boolean> {
  if (ledgerReady !== null) return ledgerReady;
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
async function materializeAudience(claimed: any): Promise<number> {
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

  const { error: stampErr } = await svc.from("broadcasts")
    .update({ materialized_at: new Date().toISOString(), total_count: rows.length })
    .eq("id", claimed.id);
  if (stampErr) throw new Error(`could not finalise the recipient list: ${stampErr.message}`);
  return rows.length;
}

// ── Counting, always from the ledger ─────────────────────────

async function ledgerCounts(broadcastId: string) {
  const svc = supabaseService();
  const one = async (status: string) => {
    const { count } = await svc.from("broadcast_sends")
      .select("id", { head: true, count: "exact" })
      .eq("broadcast_id", broadcastId).eq("status", status);
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
    .in("state", ["queued", "sending"])
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`);
  if (args.orgId) claim = claim.eq("org_id", args.orgId);

  const { data: claimed, error: claimErr } = await claim
    .select("id, org_id, subject, body_html, audience, created_at, materialized_at, total_count")
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

  try {
    let total = (claimed as any).total_count as number | null;
    if (!(claimed as any).materialized_at) {
      total = await materializeAudience(claimed);
    }

    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM_EMAIL = process.env.RESEND_FROM || "Raising Arrows <register@raisingarrowsathome.com>";
    if (!RESEND_KEY) {
      await release({ state: "failed", sent_at: new Date().toISOString() });
      const c = await ledgerCounts(args.broadcastId);
      return { broadcast_id: args.broadcastId, done: true, ...c, total };
    }
    // CASL / CAN-SPAM: never mass-mail without a working unsubscribe path.
    try { signToken("probe", 60); }
    catch (e: any) {
      console.error("[broadcasts] aborting — HMAC secret missing, cannot sign unsubscribe links:", e?.message ?? e);
      await release({ state: "failed", sent_at: new Date().toISOString() });
      const c = await ledgerCounts(args.broadcastId);
      return { broadcast_id: args.broadcastId, done: true, ...c, total };
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

      for (const row of batch as any[]) {
        if (Date.now() - started >= budgetMs) break;

        const unsubToken = signTokenWithExpiry(`unsub:${orgId}:${row.email}`, unsubExpiry);
        const unsubUrl = `${SITE}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
        const html = (claimed as any).body_html.replaceAll("{{parent_names}}", escapeHtml(row.parent_names || "friend"))
          + `<hr style="border:0;border-top:1px solid #eee;margin:36px 0 12px;">
             <p style="font-size:0.75rem;color:#aaa;margin:0;">
               You're receiving this because you're part of Raising Arrows.
               <a href="${unsubUrl}" style="color:#aaa;">Unsubscribe</a>
             </p>`;

        let verdict;
        let providerId: string | null = null;
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
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

        const attempts = (row.attempts ?? 0) + 1;
        if (verdict.outcome === "sent") {
          await svc.from("broadcast_sends").update({
            status: "sent", attempts, sent_at: new Date().toISOString(),
            provider_id: providerId, last_error: null,
          }).eq("id", row.id);
          sentThisSlice++;
        } else if (verdict.outcome === "retryable" && attempts < MAX_ATTEMPTS) {
          // Stays pending on purpose — a rate-limited family has NOT failed.
          await svc.from("broadcast_sends").update({ attempts, last_error: verdict.error }).eq("id", row.id);
          if (verdict.retryAfterMs) await sleep(Math.min(verdict.retryAfterMs, 5_000));
        } else {
          await svc.from("broadcast_sends").update({ status: "failed", attempts, last_error: verdict.error }).eq("id", row.id);
          if ((verdict as any).alert) {
            console.error("[broadcasts] provider rejected our credentials — stopping this slice");
            await release();
            const c = await ledgerCounts(args.broadcastId);
            return { broadcast_id: args.broadcastId, done: false, ...c, total };
          }
        }

        await sleep(SEND_SPACING_MS);
      }

      // Renew the lease so a long slice never loses it mid-flight.
      await svc.from("broadcasts")
        .update({
          progress_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
        })
        .eq("id", args.broadcastId).eq("lease_owner", token);
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
          .not("materialized_at", "is", null)
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
      const r = await runBroadcastSlice({ broadcastId: id, budgetMs: Math.min(SLICE_MS, budget - (Date.now() - started)) });
      out.push({ id, sent: r.sent, failed: r.failed, done: r.done });
    } catch (e: any) {
      console.error("[broadcasts] slice failed for", id, e?.message || e);
    }
  }
  return out;
}
