// PATCH /api/admin/recipients/[id]
// Admin updates approved_amount, reimbursement_rate, and/or status.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

const ALLOWED_STATUS = ["active", "completed", "suspended"] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new NextResponse("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({}));
  const update: Record<string, any> = {};

  if (body.approved_amount !== undefined) {
    const n = Number(body.approved_amount);
    if (!isFinite(n) || n < 0) return new NextResponse("invalid approved_amount", { status: 400 });
    update.approved_amount = n;
  }
  if (body.reimbursement_rate !== undefined) {
    const n = Number(body.reimbursement_rate);
    if (!isFinite(n) || n < 0 || n > 1) return new NextResponse("rate must be 0–1", { status: 400 });
    update.reimbursement_rate = n;
  }
  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.includes(body.status)) return new NextResponse("invalid status", { status: 400 });
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return new NextResponse("nothing to update", { status: 400 });
  }

  const service = supabaseService();
  const { error } = await service.from("recipients").update(update).eq("id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
