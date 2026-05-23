// ============================================================
//  backup.ts — emails a JSON dump of core tables to super_admins.
//  Called from cron dispatch on the 1st of each month.
// ============================================================

import { Resend } from "resend";
import { supabaseService } from "./supabase/server";

const TABLES = [
  "profiles", "applications", "recipients", "receipts", "photos",
  "testimonials", "payout_batches", "payouts", "app_settings",
  "email_templates", "broadcasts", "audit_log",
  "recipient_notes", "application_notes",
];

export async function emailMonthlyBackup(): Promise<{ ok: boolean; bytes?: number; error?: string }> {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.RESEND_FROM || "Raising Arrows <onboarding@resend.dev>";
  if (!RESEND_KEY) return { ok: false, error: "RESEND_API_KEY missing" };

  const svc = supabaseService();
  const { data: supers } = await svc.from("profiles").select("email").eq("role", "super_admin");
  const to = (supers ?? []).map((p: any) => p.email).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "no super_admin recipients" };

  // Dump every table (capped at 50k rows each, just in case)
  const dump: Record<string, any[]> = {};
  for (const t of TABLES) {
    const { data, error } = await svc.from(t).select("*").limit(50_000);
    if (error) { dump[t] = [{ _error: error.message }]; continue; }
    dump[t] = data ?? [];
  }
  const json = JSON.stringify({
    generated_at: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(dump).map(([k,v]) => [k, v.length])),
    data: dump,
  }, null, 2);
  const bytes = Buffer.byteLength(json, "utf8");

  // Resend attachment limit is 40MB raw; we base64 encode → ~33MB usable.
  const base64 = Buffer.from(json, "utf8").toString("base64");
  if (base64.length > 24_000_000) {
    // Don't silent-fail. Send an ALERT email instead so super_admins
    // know the backup didn't go through and can switch to manual.
    try {
      const client = new Resend(RESEND_KEY);
      await client.emails.send({
        from: FROM, to,
        subject: `[ALERT] Raising Arrows monthly backup TOO LARGE (${(bytes/1024/1024).toFixed(1)} MB)`,
        html: `<p>The monthly backup dump exceeded the email attachment cap.</p>
          <p>Raw size: <strong>${bytes} bytes</strong> (${(bytes/1024/1024).toFixed(1)} MB).</p>
          <p>Use the Supabase dashboard to take a manual backup this month,
          and consider trimming <code>audit_log</code> or splitting the
          backup by table.</p>`,
      });
    } catch { /* best-effort alert */ }
    return { ok: false, error: `dump too large: ${bytes} bytes` };
  }

  const filename = `raising-arrows-backup-${new Date().toISOString().slice(0,10)}.json`;
  try {
    const client = new Resend(RESEND_KEY);
    await client.emails.send({
      from: FROM, to,
      subject: `Raising Arrows monthly backup (${new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" })})`,
      html: `<p>Attached is the monthly database dump.</p>
        <p style="font-size:0.85rem;color:#666;">Tables: ${TABLES.join(", ")}<br/>Size: ${(bytes/1024).toFixed(0)} KB</p>
        <p style="font-size:0.85rem;color:#666;">Store offline (encrypted drive, password manager, etc) as your CRA-compliance fallback. Supabase still has the canonical copy.</p>`,
      attachments: [{ filename, content: base64 }],
    });
    return { ok: true, bytes };
  } catch (e: any) {
    return { ok: false, error: e?.message || "send failed" };
  }
}
