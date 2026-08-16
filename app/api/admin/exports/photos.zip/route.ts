// GET /api/admin/exports/photos.zip?year=YYYY
// Streams a zip of all photos for the year. Admin only. Used for
// annual-report assembly.
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel: max 60s on Pro; on Hobby this is ignored

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

export async function GET(req: Request) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  const { ctx: orgCtx } = auth;
  const svc = supabaseService();

  const url = new URL(req.url);
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : new Date().getUTCFullYear();
  const startISO = `${year}-01-01T00:00:00Z`;
  const endISO   = `${year + 1}-01-01T00:00:00Z`;

  // TWO caps, and the byte one is the real constraint. The count cap alone
  // budgeted "~30 photos x ~1MB = ~30MB", but the hosting platform refuses a
  // response body over ~4.5 MB — so a year with even a few phone photos
  // produced an opaque 500 and no zip, while working fine locally. Photos are
  // already-compressed JPEGs, so raw bytes ≈ zipped bytes.
  const MAX_PER_ZIP   = 30;
  const MAX_ZIP_BYTES = 3_500_000;
  const offsetRaw = url.searchParams.get("offset");
  const offset = offsetRaw && /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : 0;

  // First, count total to surface 'more available' guidance — per tenant.
  const { count: total } = await svc.from("photos").select("id", { count: "exact", head: true })
    .eq("org_id", orgCtx.id)
    .gte("created_at", startISO).lt("created_at", endISO);

  const { data: photos, error } = await svc.from("photos")
    .select("id, image_path, caption, created_at, recipient_id, recipients!inner(applications!inner(parent_names, app_ref))")
    .eq("org_id", orgCtx.id)
    .gte("created_at", startISO).lt("created_at", endISO)
    .order("created_at", { ascending: true })
    .range(offset, offset + MAX_PER_ZIP - 1);
  if (error) return new NextResponse(error.message, { status: 500 });
  if (!photos || photos.length === 0) {
    return new NextResponse(`No photos in ${year} starting at offset ${offset}.`, { status: 404 });
  }

  const zip = new JSZip();
  const folder = zip.folder(`${orgCtx.slug}-photos-${year}`)!;

  // Manifest of which photo came from which family
  const manifest: string[] = ["filename,family,app_ref,caption,created_at"];

  let bytes = 0;
  let included = 0;
  let stoppedForSize = false;

  for (const p of (photos as any[]) ?? []) {
    try {
      const { data: file } = await svc.storage.from("photos").download(p.image_path);
      if (!file) continue;
      const ext = p.image_path.split(".").pop() ?? "jpg";
      const fam = safeName(p.recipients.applications.parent_names || "unknown");
      const filename = `${fam}-${p.id.slice(0,8)}.${ext}`;
      const buf = Buffer.from(await file.arrayBuffer());
      // Stop BEFORE crossing the budget, but always include at least one photo
      // so a single large image still downloads rather than returning nothing.
      if (included > 0 && bytes + buf.length > MAX_ZIP_BYTES) { stoppedForSize = true; break; }
      bytes += buf.length;
      included += 1;
      folder.file(filename, buf);
      manifest.push(`${filename},"${p.recipients.applications.parent_names}",${p.recipients.applications.app_ref},"${(p.caption||"").replace(/"/g,'""')}",${p.created_at}`);
    } catch (e) {
      // Skip individual failures, continue with rest
    }
  }
  folder.file("MANIFEST.csv", manifest.join("\n"));

  const blob = await zip.generateAsync({ type: "nodebuffer" });
  const headers: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${orgCtx.slug}-photos-${year}-from-${offset}.zip"`,
    "Cache-Control": "no-store",
  };
  // Pagination must count what was actually PUT IN the zip, not what was
  // fetched — otherwise a size-truncated batch silently skips photos.
  const nextOffset = offset + included;
  if (stoppedForSize) headers["X-Stopped-For-Size"] = "1";
  if ((total ?? 0) > nextOffset) {
    headers["X-Next-Offset"] = String(nextOffset);
    headers["X-Total-Photos"] = String(total);
  }
  return new NextResponse(blob as any, { status: 200, headers });
}
