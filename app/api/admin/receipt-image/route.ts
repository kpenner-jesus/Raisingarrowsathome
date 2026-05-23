// GET /api/admin/receipt-image?path=<bucket-path>
// Returns a redirect to a short-lived signed URL so admins can view
// receipt images that live in a private storage bucket.
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export async function GET(req: Request) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new Response("forbidden", { status: 403 });

  const path = new URL(req.url).searchParams.get("path");
  if (!path) return new Response("missing path", { status: 400 });

  const service = supabaseService();
  const { data, error } = await service.storage.from("receipts").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return new Response(error?.message || "could not sign url", { status: 500 });

  return Response.redirect(data.signedUrl, 302);
}
