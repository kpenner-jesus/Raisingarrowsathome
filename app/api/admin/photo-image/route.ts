// GET /api/admin/photo-image?id=<photo_id>
//
// Same pattern as receipt-image: lookup path by id so admin can't sign
// an arbitrary storage path passed by an attacker.
import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";
import { assertPathBelongsToOrg } from "@/app/lib/storage-path";

export async function GET(req: Request) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new Response(e.message, { status: e.status });
    throw e;
  }
  const { ctx: orgCtx } = auth;

  const url = new URL(req.url);
  const id  = url.searchParams.get("id");
  if (!id) return new Response("missing photo id", { status: 400 });

  const service = supabaseService();
  // Scope by org so a photo id from another tenant can't be signed here.
  const { data: photo, error: loadErr } = await service
    .from("photos").select("image_path")
    .eq("id", id).eq("org_id", orgCtx.id).single();
  if (loadErr || !photo) return new Response("photo not found", { status: 404 });

  // See receipt-image/route.ts for rationale.
  try { assertPathBelongsToOrg(photo.image_path, orgCtx.id); }
  catch (e: any) { return new Response(e?.message || "path/tenant mismatch", { status: 403 }); }

  const { data, error } = await service.storage.from("photos").createSignedUrl(photo.image_path, 300);
  if (error || !data?.signedUrl) return new Response(error?.message || "could not sign url", { status: 500 });

  return Response.redirect(data.signedUrl, 302);
}
