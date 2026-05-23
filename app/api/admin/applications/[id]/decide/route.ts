import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";
import { decideApplication } from "@/app/lib/admin/decide-application";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new NextResponse("forbidden", { status: 403 });

  const { decision, approved_amount, rate, notes } = await req.json();
  if (!["approved", "denied"].includes(decision)) return new NextResponse("bad decision", { status: 400 });

  try {
    const result = await decideApplication({
      applicationId:    params.id,
      decision,
      approved_amount,
      rate,
      notes,
      deciderProfileId: user.id,
      origin:           new URL(req.url).origin,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return new NextResponse(e?.message || "decide failed", { status: 500 });
  }
}
