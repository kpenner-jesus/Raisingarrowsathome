// ============================================================
//  /api/admin/staging-reset
//
//  GET  — what would be erased, and may this deployment do it?
//  POST — erase this tenant's practice data.
//
//  Every decidable gate lives in app/lib/staging-reset.ts and is
//  unit-tested there. This file does IO only.
//
//  There is deliberately NO SQL function for this. A "delete
//  everything" routine defined in the database would also exist in
//  the PRODUCTION database, one bad call away from being run. The
//  destructive logic lives here instead, behind the interlock, and
//  production never has anything to call.
// ============================================================

import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";
import { assertPathBelongsToOrg } from "@/app/lib/storage-path";
import { writeAudit } from "@/app/lib/audit";
import {
  resetGuard, resetAvailable, WIPE_ORDER, WIPE_BUCKETS, RESET_PHRASE,
} from "@/app/lib/staging-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(req?: Request) {
  return {
    VERCEL_ENV:                 process.env.VERCEL_ENV,
    NEXT_PUBLIC_SUPABASE_URL:   process.env.NEXT_PUBLIC_SUPABASE_URL,
    RESET_ALLOWED_SUPABASE_REF: process.env.RESET_ALLOWED_SUPABASE_REF,
    // The host the request actually arrived on. A build compiled in the
    // preview scope can be promoted or rolled back onto the LIVE domain, and
    // it carries VERCEL_ENV=preview and staging's inlined database URL with
    // it — so every env-based gate would pass on the real site.
    requestHost:                req?.headers.get("host") ?? null,
  };
}

/**
 * Real membership of THIS org, ignoring the platform super_admin backdoor.
 *
 * requireAdmin() lets a super_admin through without any org_members row, and
 * middleware.ts does not match /api/*, so the org this route resolves comes
 * from a header the CALLER supplies. Combined, a super_admin could name any
 * charity's slug and erase it. A bulk delete is not a support action, so this
 * route demands genuine membership.
 */
async function requireRealMembership(userId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseService()
    .from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  return data?.role === "owner" || data?.role === "admin";
}

async function auth() {
  try { return { auth: await requireAdmin(), err: null as null | NextResponse }; }
  catch (e) {
    if (e instanceof AdminAuthError) {
      return { auth: null, err: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    throw e;
  }
}

/** GET — counts, so the confirmation can say exactly what disappears. */
export async function GET(req: Request) {
  const { auth: a, err } = await auth();
  if (err) return err;
  const orgId = a!.ctx.id;

  if (!(await requireRealMembership(a!.user.id, orgId))) {
    return NextResponse.json({ available: false, reason: "not a member of this organisation", counts: {}, total: 0 });
  }

  const available = resetAvailable(env(req));
  if (!available) {
    const g = resetGuard(env(req), RESET_PHRASE);
    return NextResponse.json({
      available: false,
      reason: g.allowed ? "" : g.reason,
      counts: {},
      total: 0,
    });
  }

  const svc = supabaseService();
  const counts: Record<string, number> = {};
  let total = 0;
  for (const table of WIPE_ORDER) {
    const { count, error } = await svc.from(table)
      .select("*", { count: "exact", head: true }).eq("org_id", orgId);
    // A table missing on this deployment is not an error worth failing on —
    // migrations here are applied by hand.
    if (error) continue;
    counts[table] = count ?? 0;
    total += count ?? 0;
  }

  return NextResponse.json({ available: true, phrase: RESET_PHRASE, counts, total });
}

/** POST — do it. */
export async function POST(req: Request) {
  const { auth: a, err } = await auth();
  if (err) return err;
  const { ctx: orgCtx, user } = a!;

  const body = await req.json().catch(() => ({} as any));

  if (!(await requireRealMembership(user.id, orgCtx.id))) {
    console.warn("[staging-reset] REFUSED — caller is not a member of the target org", {
      org: orgCtx.slug, by: user.email,
    });
    return NextResponse.json({ error: "you are not a member of this organisation" }, { status: 403 });
  }

  const guard = resetGuard(env(req), body?.confirm);
  if (!guard.allowed) {
    console.warn("[staging-reset] REFUSED", { org: orgCtx.slug, reason: guard.reason });
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }

  const orgId = orgCtx.id;
  const svc = supabaseService();
  console.warn("[staging-reset] ERASING practice data", {
    db: guard.ref, org: orgCtx.slug, by: user.email,
  });

  // ── 1. Collect the storage paths BEFORE their rows disappear ────────────
  //     Paths are <user>/<org>/<file>, so the org is the SECOND segment and a
  //     prefix scan cannot find them. Take the exact paths off the rows we are
  //     about to delete, and verify each one really is this tenant's.
  const filesByBucket: Record<string, string[]> = { receipts: [], photos: [] };
  for (const [table, bucket] of [["receipts", "receipts"], ["photos", "photos"]] as const) {
    const { data } = await svc.from(table).select("image_path").eq("org_id", orgId);
    for (const row of data ?? []) {
      const p = (row as any).image_path;
      if (typeof p !== "string" || !p) continue;
      try { assertPathBelongsToOrg(p, orgId); } catch { continue; }  // never touch a foreign path
      filesByBucket[bucket].push(p);
    }
  }

  // ── 2. Remove the files ─────────────────────────────────────────────────
  const removed: Record<string, number> = {};
  for (const bucket of WIPE_BUCKETS) {
    const paths = filesByBucket[bucket] ?? [];
    removed[bucket] = 0;
    for (let i = 0; i < paths.length; i += 100) {          // storage caps a batch
      const slice = paths.slice(i, i + 100);
      const { error } = await svc.storage.from(bucket).remove(slice);
      if (error) console.error(`[staging-reset] storage ${bucket}:`, error.message);
      else removed[bucket] += slice.length;
    }
  }

  // ── 3. Delete the rows, children first ──────────────────────────────────
  //     Not a transaction: PostgREST has no cross-statement transaction here.
  //     That is acceptable precisely BECAUSE this is practice data — a partial
  //     run is fixed by pressing the button again. It would not be acceptable
  //     anywhere near production, which is what the interlock is for.
  const deleted: Record<string, number> = {};
  const failures: string[] = [];
  for (const table of WIPE_ORDER) {
    const { error, count } = await svc.from(table)
      .delete({ count: "exact" }).eq("org_id", orgId);
    if (error) {
      // Missing table = nothing to erase. Anything else is worth reporting.
      const code = (error as any).code;
      if (code !== "42P01" && code !== "PGRST205") {
        failures.push(`${table}: ${error.message}`);
        console.error(`[staging-reset] ${table}:`, error.message);
      }
      continue;
    }
    deleted[table] = count ?? 0;
  }

  // ── 4. Leave a record. audit_log was just cleared, so this is the first
  //      entry of the clean slate rather than a survivor of the old one.
  await writeAudit({
    orgId,
    actorId: user.id,
    action: "staging_data_erased",
    targetTable: "tenants",
    targetId: orgId,
    details: { database: guard.ref, deleted, files_removed: removed, failures },
  }).catch(() => { /* never fail the reset on its own bookkeeping */ });

  const totalRows = Object.values(deleted).reduce((s, n) => s + n, 0);
  console.warn("[staging-reset] done", { rows: totalRows, files: removed, failures: failures.length });

  return NextResponse.json({
    ok: failures.length === 0,
    database: guard.ref,
    rows_deleted: totalRows,
    by_table: deleted,
    files_removed: removed,
    failures,
  });
}
