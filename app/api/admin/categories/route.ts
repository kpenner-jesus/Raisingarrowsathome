// POST /api/admin/categories   { label }
// PATCH /api/admin/categories  { id, archived?: boolean, label?, sort_order? }
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

async function adminCtx() {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user, svc };
}

export async function POST(req: Request) {
  const c = await adminCtx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => ({} as any));
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 60) return NextResponse.json({ error: "label required, max 60" }, { status: 400 });

  // Default sort_order = max+10
  const { data: maxRow } = await c.svc.from("receipt_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const sort_order = ((maxRow?.[0]?.sort_order as number) ?? 0) + 10;

  const { data, error } = await c.svc.from("receipt_categories").insert({ label, sort_order }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: c.user.id, action: "add_category",
    targetTable: "receipt_categories", targetId: data.id, details: { label },
  });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: Request) {
  const c = await adminCtx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => ({} as any));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, any> = {};
  if (body.archived === true)  update.archived_at = new Date().toISOString();
  if (body.archived === false) update.archived_at = null;
  if (typeof body.label === "string" && body.label.trim()) update.label = body.label.trim().slice(0, 60);
  if (typeof body.sort_order === "number") update.sort_order = Math.floor(body.sort_order);

  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  // Friendly unique-label check before letting Postgres throw
  if (update.label) {
    const { data: collide } = await c.svc.from("receipt_categories")
      .select("id").eq("label", update.label).neq("id", id).maybeSingle();
    if (collide) return NextResponse.json({ error: `Another category already uses the label '${update.label}'` }, { status: 409 });
  }

  const { error } = await c.svc.from("receipt_categories").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: c.user.id, action: "update_category",
    targetTable: "receipt_categories", targetId: id, details: update,
  });
  return NextResponse.json({ ok: true });
}
