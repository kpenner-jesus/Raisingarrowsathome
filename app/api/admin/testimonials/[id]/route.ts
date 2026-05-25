// PATCH /api/admin/testimonials/[id]
//   body: { status?: 'pending'|'approved'|'hidden', featured?: boolean }
// DELETE /api/admin/testimonials/[id] (not provided — use status='hidden' instead)
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

const VALID_STATUSES = new Set(["pending", "approved", "hidden"]);

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;
  const svc = supabaseService();

  let body: { status?: string; featured?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const updates: Record<string, any> = {};
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status invalid" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (body.featured !== undefined) {
    if (typeof body.featured !== "boolean") {
      return NextResponse.json({ error: "featured must be boolean" }, { status: 400 });
    }
    updates.featured = body.featured;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields" }, { status: 400 });
  }

  updates.reviewed_by = user.id;
  updates.reviewed_at = new Date().toISOString();

  // Scope every read/write to the caller's tenant.
  const { data: before } = await svc.from("testimonials")
    .select("status, featured").eq("id", id).eq("org_id", orgCtx.id).single();
  if (!before) return NextResponse.json({ error: "testimonial not found" }, { status: 404 });

  const { data: after, error } = await svc.from("testimonials")
    .update(updates).eq("id", id).eq("org_id", orgCtx.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pick the most specific audit label that matches this PATCH. Falls back
  // to a generic "update_testimonial" instead of mislabelling un-features
  // and other partial edits as 'approve_testimonial'.
  const action =
    updates.status   === "hidden"      ? "hide_testimonial"   :
    updates.status   === "approved"    ? "approve_testimonial":
    updates.featured === true          ? "feature_testimonial":
    updates.featured === false         ? "unfeature_testimonial":
                                          "update_testimonial";

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action,
    targetTable: "testimonials",
    targetId: id,
    details: { from: before, to: { status: after.status, featured: after.featured } },
  });

  return NextResponse.json({ ok: true, testimonial: after });
}
