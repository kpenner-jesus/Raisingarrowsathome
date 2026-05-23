// GET /api/admin/receipt-image?id=<receipt_id>
//
// Security: resolves image_path by the receipt's id (not from the query string)
// so admin can't be tricked into signing an arbitrary storage path.
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export async function GET(req: Request) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const id  = url.searchParams.get("id");
  if (!id) return new Response("missing receipt id", { status: 400 });

  const service = supabaseService();
  const { data: receipt, error: loadErr } = await service
    .from("receipts").select("image_path").eq("id", id).single();
  if (loadErr || !receipt) return new Response("receipt not found", { status: 404 });

  const { data, error } = await service.storage.from("receipts").createSignedUrl(receipt.image_path, 300, {
    download: false,
  });
  if (error || !data?.signedUrl) return new Response(error?.message || "could not sign url", { status: 500 });

  return Response.redirect(data.signedUrl, 302);
}
