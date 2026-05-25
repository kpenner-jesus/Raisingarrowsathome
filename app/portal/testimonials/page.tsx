import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getEffectiveRecipient } from "@/app/lib/impersonation";
import TestimonialForm from "./TestimonialForm";

export const dynamic = "force-dynamic";

export default async function TestimonialsPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx = await getEffectiveRecipient(user.id);
  const recipient = ctx.recipient;
  if (!recipient) return <p style={{ color: "var(--text-secondary)" }}>Account not linked to a grant.</p>;

  // Service-role when impersonating so the read isn't blocked by RLS.
  const dataClient = ctx.mode === "impersonating" ? supabaseService() : supabase;
  const { data: items } = await dataClient
    .from("testimonials")
    .select("*")
    .eq("recipient_id", recipient.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "0.75rem" }}>
        Share a testimonial
      </h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "1.75rem", lineHeight: 1.6 }}>
        Tell us how homeschooling is going for your family. We may share excerpts to encourage other families considering this path.
      </p>

      <TestimonialForm />

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginTop: "2.5rem", marginBottom: "0.75rem" }}>
        Your past testimonials
      </h2>
      {items && items.length > 0 ? items.map((t: any) => (
        <div key={t.id} style={{
          background: "rgba(255,255,255,0.75)",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 10,
          padding: "1rem 1.25rem",
          marginBottom: "0.75rem",
          whiteSpace: "pre-wrap",
          fontSize: "0.95rem",
          lineHeight: 1.6,
        }}>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            {new Date(t.created_at).toLocaleDateString()}
          </div>
          {t.body}
        </div>
      )) : <p style={{ color: "var(--text-muted)" }}>None yet.</p>}
    </div>
  );
}
