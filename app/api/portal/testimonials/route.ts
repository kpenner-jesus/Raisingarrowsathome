// POST /api/portal/testimonials — recipient submits a written testimonial
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: recipient } = await supabase
    .from("recipients").select("id").eq("profile_id", user.id).maybeSingle();
  if (!recipient) return new NextResponse("no recipient", { status: 400 });

  const { body } = await req.json();
  if (!body?.trim()) return new NextResponse("empty body", { status: 400 });

  const { error } = await supabase.from("testimonials").insert({
    recipient_id: recipient.id,
    body: body.trim(),
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
