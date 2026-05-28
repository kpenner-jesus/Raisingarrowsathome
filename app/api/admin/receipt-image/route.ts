// GET /api/admin/receipt-image?id=<receipt_id>
//
// Security: resolves image_path by the receipt's id (not from the query string)
// so admin can't be tricked into signing an arbitrary storage path.
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
  if (!id) return new Response("missing receipt id", { status: 400 });

  const service = supabaseService();
  // Scope by org so a receipt id from another tenant can't be signed here.
  const { data: receipt, error: loadErr } = await service
    .from("receipts").select("image_path")
    .eq("id", id).eq("org_id", orgCtx.id).single();
  if (loadErr || !receipt) return new Response("receipt not found", { status: 404 });

  // Defence-in-depth: row was already filtered by org_id, but if image_path was
  // ever mutated to point at another tenant's file (future bug), the embedded
  // tenant segment will mismatch — refuse to sign instead of leaking the file.
  // assertPathBelongsToOrg requires the 3-segment <user>/<org>/<file> layout and
  // THROWS on anything else (incl. legacy 2-segment paths); we 403 on throw.
  // Verified zero non-3-segment rows exist in prod before tightening.
  try { assertPathBelongsToOrg(receipt.image_path, orgCtx.id); }
  catch (e: any) { return new Response(e?.message || "path/tenant mismatch", { status: 403 }); }

  const { data, error } = await service.storage.from("receipts").createSignedUrl(receipt.image_path, 300, {
    download: false,
  });
  if (error || !data?.signedUrl) return new Response(error?.message || "could not sign url", { status: 500 });

  return Response.redirect(data.signedUrl, 302);
}
