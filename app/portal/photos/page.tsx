import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: recipient } = await supabase
    .from("recipients").select("id").eq("profile_id", user.id).maybeSingle();
  if (!recipient) return <p style={{ color: "var(--text-secondary)" }}>Account not linked to a grant.</p>;

  const { data: photos } = await supabase
    .from("photos").select("*").eq("recipient_id", recipient.id).order("created_at", { ascending: false });

  // Sign each path so the <img> can load (private bucket).
  const signed = await Promise.all((photos || []).map(async (p: any) => {
    const { data } = await supabase.storage.from("photos").createSignedUrl(p.image_path, 600);
    return { ...p, signed_url: data?.signedUrl ?? null };
  }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem" }}>Your photos</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem", fontSize: "0.92rem" }}>
            Share moments from your homeschool journey.
          </p>
        </div>
        <Link href="/portal/photos/new" className="tf-ok ra-only-desktop" style={{ textDecoration: "none" }}>
          + Upload photo
        </Link>
      </div>

      {signed.length === 0 ? (
        <div className="ra-photo-grid ra-photo-grid-mobile" style={{ minHeight: 200 }}>
          <Link href="/portal/photos/new" className="ra-photo-tile ra-photo-add" aria-label="Add a photo">+</Link>
        </div>
      ) : (
        <div className="ra-photo-grid ra-photo-grid-mobile">
          <Link href="/portal/photos/new" className="ra-photo-tile ra-photo-add ra-only-mobile" aria-label="Add a photo">+</Link>
          {signed.map((p: any) => (
            <div key={p.id} className="ra-photo-tile" style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.08)" }}>
              {p.signed_url
                ? <img src={p.signed_url} alt={p.caption || ""} />
                : <div style={{ aspectRatio: "1/1", background: "#eee", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "0.8rem" }}>image unavailable</div>}
              {p.caption && (
                <div style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4, background: "rgba(255,255,255,0.92)" }}>
                  {p.caption}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Mobile sticky upload CTA, hidden on desktop */}
      <div className="ra-only-mobile ra-mobile-cta" style={{ marginTop: "1rem" }}>
        <Link href="/portal/photos/new" className="ra-btn ra-btn-primary" style={{ textDecoration: "none" }}>
          + Upload photo
        </Link>
      </div>
    </div>
  );
}
