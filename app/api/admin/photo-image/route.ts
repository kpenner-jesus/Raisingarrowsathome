// GET /api/admin/photo-image?id=<photo_id>
//
// Same pattern as receipt-image: lookup path by id so admin can't sign
// an arbitrary storage path passed by an attacker.
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export async function GET(req: Request) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const id  = url.searchParams.get("id");
  if (!id) return new Response("missing photo id", { status: 400 });

  const service = supabaseService();
  const { data: photo, error: loadErr } = await service
    .from("photos").select("image_path").eq("id", id).single();
  if (loadErr || !photo) return new Response("photo not found", { status: 404 });

  const { data, error } = await service.storage.from("photos").createSignedUrl(photo.image_path, 300);
  if (error || !data?.signedUrl) return new Response(error?.message || "could not sign url", { status: 500 });

  return Response.redirect(data.signedUrl, 302);
}
