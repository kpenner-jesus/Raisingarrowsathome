// ============================================================
//  Browser-side image compression — no external library.
//
//  - Skips non-images (PDFs pass through untouched)
//  - Skips small files (under SMALL_BYPASS_BYTES)
//  - Skips HEIC/HEIF if the browser can't decode them
//  - Max edge SCALED to MAX_EDGE_PX (preserves aspect ratio)
//  - Output: JPEG at QUALITY (0.85 by default — sharp for receipts)
//  - Applies EXIF orientation automatically via createImageBitmap
// ============================================================

const MAX_EDGE_PX        = 2400;
const QUALITY            = 0.85;
const SMALL_BYPASS_BYTES = 600 * 1024;  // under 600KB → don't bother

export async function compressImage(file: File): Promise<File> {
  // PDFs + non-images pass through.
  if (!file.type.startsWith("image/")) return file;
  // Small files don't need compression.
  if (file.size <= SMALL_BYPASS_BYTES)  return file;

  // Try to decode. If the browser can't (e.g. HEIC on non-Safari), return original.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
  } catch {
    return file;
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  const scale   = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;
  const w = Math.round(width  * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) return file;
  // Only return the smaller of the two — if compression INCREASED size (rare,
  // small detailed images), keep the original.
  if (blob.size >= file.size) return file;

  // Rename with .jpg extension since we recoded to JPEG.
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}
