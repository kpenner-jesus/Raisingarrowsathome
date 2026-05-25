// POST /api/admin/categories   { label }
// PATCH /api/admin/categories  { id, archived?: boolean, label?, sort_order? }
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

async function authOrError() {
  try { return await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) {
      return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    throw e;
  }
}

export async function POST(req: Request) {
  const c = await authOrError();
  if ("error" in c) return c.error;
  const { user, ctx: orgCtx } = c;
  const svc = supabaseService();

  const body = await req.json().catch(() => ({} as any));
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 60) return NextResponse.json({ error: "label required, max 60" }, { status: 400 });

  // Default sort_order = max+10 (per-tenant max so categories from other orgs
  // don't bump this org's sort numbering).
  const { data: maxRow } = await svc.from("receipt_categories")
    .select("sort_order").eq("org_id", orgCtx.id)
    .order("sort_order", { ascending: false }).limit(1);
  const sort_order = ((maxRow?.[0]?.sort_order as number) ?? 0) + 10;

  const { data, error } = await svc.from("receipt_categories")
    .insert({ org_id: orgCtx.id, label, sort_order })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id, action: "add_category",
    targetTable: "receipt_categories", targetId: data.id, details: { label },
  });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: Request) {
  const c = await authOrError();
  if ("error" in c) return c.error;
  const { user, ctx: orgCtx } = c;
  const svc = supabaseService();

  const body = await req.json().catch(() => ({} as any));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, any> = {};
  if (body.archived === true)  update.archived_at = new Date().toISOString();
  if (body.archived === false) update.archived_at = null;
  if (typeof body.label === "string" && body.label.trim()) update.label = body.label.trim().slice(0, 60);
  if (typeof body.sort_order === "number") update.sort_order = Math.floor(body.sort_order);

  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  // Friendly unique-label check before letting Postgres throw — scoped per-tenant
  // so two different orgs can have a category with the same label.
  if (update.label) {
    const { data: collide } = await svc.from("receipt_categories")
      .select("id").eq("org_id", orgCtx.id).eq("label", update.label).neq("id", id).maybeSingle();
    if (collide) return NextResponse.json({ error: `Another category already uses the label '${update.label}'` }, { status: 409 });
  }

  const { error } = await svc.from("receipt_categories").update(update).eq("id", id).eq("org_id", orgCtx.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id, action: "update_category",
    targetTable: "receipt_categories", targetId: id, details: update,
  });
  return NextResponse.json({ ok: true });
}
