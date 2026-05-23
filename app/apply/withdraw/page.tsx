// /apply/withdraw?token=...
// Family clicks the link from their confirmation email. Token = HMAC
// signed `withdraw:<application_id>` with 30-day TTL.
import Link from "next/link";
import { verifyToken } from "@/app/lib/hmac";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

export const dynamic = "force-dynamic";

export default async function WithdrawPage({ searchParams }: { searchParams?: { token?: string } }) {
  const token = searchParams?.token ?? "";
  if (!token) return shell("Link missing token", "The withdrawal link is incomplete.");

  const v = verifyToken(token);
  if (!v.ok) return shell("Link expired or invalid", `We couldn't verify this link (${v.reason}). Email register@raisingarrowsathome.com if you'd like us to withdraw your application manually.`);

  if (!v.payload.startsWith("withdraw:")) return shell("Wrong link type", "This link isn't a withdrawal link.");
  const applicationId = v.payload.slice("withdraw:".length);

  const svc = supabaseService();
  const { data: app } = await svc.from("applications")
    .select("id, parent_names, status")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return shell("Not found", "We couldn't find that application.");

  if (app.status === "withdrawn") {
    return shell("Already withdrawn", `Your application has already been marked withdrawn. No further action needed.`);
  }
  if (app.status !== "pending") {
    return shell("Cannot withdraw", `Your application is currently '${app.status}' — only pending applications can be self-withdrawn. Email register@raisingarrowsathome.com if you'd still like to cancel.`);
  }

  // Withdraw (idempotent: only update if still pending)
  const { error } = await svc.from("applications")
    .update({ status: "withdrawn", decided_at: new Date().toISOString() })
    .eq("id", applicationId).eq("status", "pending");
  if (error) return shell("Something went wrong", error.message);

  await writeAudit({
    actorId: null,                              // self-service, no admin actor
    action: "withdraw_application",
    targetTable: "applications",
    targetId: applicationId,
    details: { parent_names: app.parent_names, source: "self-service-link" },
  });

  return shell("Application withdrawn", `Thanks, ${app.parent_names}. Your application has been withdrawn. We hope to hear from your family again whenever the timing is right.`);
}

function shell(title: string, body: string) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", fontWeight: 500, marginBottom: "1rem" }}>{title}</h1>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, fontSize: "1rem" }}>{body}</p>
        <Link href="/" style={{ display: "inline-block", marginTop: "2rem", color: "var(--text-muted)", textDecoration: "underline" }}>
          ← Back to website
        </Link>
      </div>
    </div>
  );
}
