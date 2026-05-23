// GET /api/admin/exports/photos.zip?year=YYYY
// Streams a zip of all photos for the year. Admin only. Used for
// annual-report assembly.
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel: max 60s on Pro; on Hobby this is ignored

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

export async function GET(req: Request) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : new Date().getUTCFullYear();
  const startISO = `${year}-01-01T00:00:00Z`;
  const endISO   = `${year + 1}-01-01T00:00:00Z`;

  const { data: photos, error } = await svc.from("photos")
    .select("id, image_path, caption, created_at, recipient_id, recipients!inner(applications!inner(parent_names, app_ref))")
    .gte("created_at", startISO).lt("created_at", endISO)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return new NextResponse(error.message, { status: 500 });

  const zip = new JSZip();
  const folder = zip.folder(`raising-arrows-photos-${year}`)!;

  // Manifest of which photo came from which family
  const manifest: string[] = ["filename,family,app_ref,caption,created_at"];

  for (const p of (photos as any[]) ?? []) {
    try {
      const { data: file } = await svc.storage.from("photos").download(p.image_path);
      if (!file) continue;
      const ext = p.image_path.split(".").pop() ?? "jpg";
      const fam = safeName(p.recipients.applications.parent_names || "unknown");
      const filename = `${fam}-${p.id.slice(0,8)}.${ext}`;
      const buf = Buffer.from(await file.arrayBuffer());
      folder.file(filename, buf);
      manifest.push(`${filename},"${p.recipients.applications.parent_names}",${p.recipients.applications.app_ref},"${(p.caption||"").replace(/"/g,'""')}",${p.created_at}`);
    } catch (e) {
      // Skip individual failures, continue with rest
    }
  }
  folder.file("MANIFEST.csv", manifest.join("\n"));

  const blob = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(blob as any, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="raising-arrows-photos-${year}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
