// POST /api/portal/photos — recipient submits a photo record after upload.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: recipient } = await supabase
    .from("recipients").select("id").eq("profile_id", user.id).maybeSingle();
  if (!recipient) return new NextResponse("no recipient", { status: 400 });

  const { image_path, caption } = await req.json();
  if (!image_path) return new NextResponse("missing image_path", { status: 400 });

  const { error } = await supabase.from("photos").insert({
    recipient_id: recipient.id,
    image_path,
    caption: caption?.trim() || null,
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
