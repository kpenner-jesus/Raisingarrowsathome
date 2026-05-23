import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminHelp() {
  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: "Overview — what this portal does",
      body: (
        <>
          <p>The portal handles the whole grant pipeline:</p>
          <ol style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
            <li>Family applies via the public form on the landing page.</li>
            <li>You review and approve (or deny) at <strong>/admin/applications</strong>.</li>
            <li>Approved → becomes a <strong>recipient</strong>. They get a portal login.</li>
            <li>They upload receipts. You approve each one at <strong>/admin/recipients/[id]</strong>.</li>
            <li>On the 15th and last day of each month, the system auto-generates a payout batch.</li>
            <li>You download the CSV, send to CEO Ministries, they e-transfer the families.</li>
            <li>You hit <strong>Mark paid</strong>, the system emails everyone.</li>
          </ol>
        </>
      ),
    },
    {
      title: "Applications — approving / denying",
      body: (
        <>
          <p><strong>Cap</strong> is the maximum total reimbursement the family can receive. Default = sum of age-tier caps for their kids. Override if you want.</p>
          <p><strong>Reimbursement rate</strong> = the percentage of each approved receipt we pay back. Standard = 75%. Lower it for partial coverage situations.</p>
          <p>On <strong>Approve</strong>: a recipient row is created, the applicant gets a magic-link sign-in email + an approval email.</p>
          <p>On <strong>Deny</strong>: applicant gets a denial email with your notes (if any).</p>
          <p>Atomic + idempotent: clicking twice doesn&apos;t send two emails. If anything fails (Supabase invite rate limit, etc.), the application stays in &quot;pending&quot; — safe to retry.</p>
        </>
      ),
    },
    {
      title: "Receipts — approving + reimbursable amounts",
      body: (
        <>
          <p>Each receipt has an <strong>amount</strong> (what the family paid, in their currency) and a <strong>reimbursable amount</strong> (what we&apos;ll actually pay back, in CAD).</p>
          <p>When approving:</p>
          <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
            <li><strong>CAD receipts:</strong> default reimbursable = receipt × rate (e.g. $100 × 75% = $75). Change it if you&apos;re reimbursing partial (shipping splits, etc.).</li>
            <li><strong>USD receipts:</strong> you MUST type the CAD reimbursable. No auto-conversion.</li>
          </ul>
          <p>The recipient gets an &quot;approved&quot; or &quot;rejected&quot; email either way. On reject, your notes are included.</p>
        </>
      ),
    },
    {
      title: "Payouts — schedule + CSV handoff",
      body: (
        <>
          <p>Two scheduled payouts per month:</p>
          <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
            <li><strong>15th @ 12:00 UTC</strong> — &quot;mid&quot; bucket batch generated automatically</li>
            <li><strong>Last day of month @ 12:00 UTC</strong> — &quot;end&quot; bucket batch generated automatically</li>
          </ul>
          <p>You also get a <strong>summary email</strong> on the 1st (for the 15th window) and the 17th (for the end-of-month window). It lists pending receipts to review + approved receipts queued for payout.</p>
          <p>Each batch:</p>
          <ol style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
            <li><strong>Draft</strong> — auto-generated, contains every eligible recipient&apos;s next payout amount.</li>
            <li>You click <strong>Download CSV</strong> → batch becomes <strong>exported</strong>.</li>
            <li>You send the CSV to CEO Ministries accounting.</li>
            <li>They send the e-transfers, you get confirmation.</li>
            <li>You click <strong>Mark paid</strong> + optionally enter the CEO reference number → batch becomes <strong>paid</strong>, all recipients get a &quot;payout sent&quot; email.</li>
          </ol>
          <p>You can also click <strong>Generate batch now</strong> any time for ad-hoc batches (stamped as &quot;manual&quot;).</p>
        </>
      ),
    },
    {
      title: "Recipients — modifying + statuses",
      body: (
        <>
          <p>Three statuses:</p>
          <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
            <li><strong>active</strong> — included in auto-generated payout batches.</li>
            <li><strong>suspended</strong> — excluded from auto-batches. Use for problem cases.</li>
            <li><strong>completed</strong> — excluded from auto-batches. Use when the grant is done.</li>
          </ul>
          <p>You can adjust <strong>cap</strong> and <strong>reimbursement rate</strong> any time via the Modify form on the recipient detail page. There&apos;s a $50,000 sanity cap on the dollar amount.</p>
          <p><strong>Submission deadline</strong>: new approvals get a default 6-month deadline. After that, the recipient can&apos;t upload more receipts (portal blocks it). The 7 grandfathered families have NULL deadlines.</p>
        </>
      ),
    },
    {
      title: "Team (super_admin only)",
      body: (
        <>
          <p>Tierza is the super_admin. Only she can invite or remove other admins.</p>
          <p>Two role levels:</p>
          <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
            <li><strong>admin</strong> — full read/write on applications, recipients, receipts, payouts.</li>
            <li><strong>super_admin</strong> — everything admin can do, PLUS manage the Team page (invite, change roles, revoke).</li>
          </ul>
          <p>Safety: the system won&apos;t let the last super_admin be demoted (avoids lockout).</p>
        </>
      ),
    },
    {
      title: "Common scenarios — worked examples",
      body: (
        <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.85 }}>
          <li>
            <strong>Family submits $250 USD receipt:</strong> open recipient → click ✓ on the receipt → modal opens →
            type <code>~340</code> in &quot;Reimbursable amount (CAD)&quot; (whatever the current rate gives you) → Approve.
            They get an &quot;approved&quot; email; the $340 lands in their next payout.
          </li>
          <li>
            <strong>Family went in on a $1,200 Rainbow Resource order with 3 other families:</strong> they upload the
            full $1,200 receipt with description &quot;shared with X, Y, Z — my $300 share&quot;. You approve with
            <code>$225</code> reimbursable ($300 × 75%).
          </li>
          <li>
            <strong>You accidentally approved a receipt that shouldn&apos;t have been:</strong> there&apos;s no
            in-UI &quot;undo&quot; yet. Best path: ask the family to upload a corrected receipt, deny the original
            via direct DB tweak (or ask Kevin). A proper edit/revoke UI is on the roadmap.
          </li>
          <li>
            <strong>Cron is suspiciously quiet:</strong> open Vercel → Cron tab. All 4 schedules should show recent
            runs. If a generate cron failed because no recipients were eligible, that&apos;s normal — the run just
            inserts an empty batch.
          </li>
        </ul>
      ),
    },
    {
      title: "Where to look when something breaks",
      body: (
        <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
          <li>Vercel logs: <code>vercel.com</code> → project → Logs tab</li>
          <li>Supabase audit_log table: every receipt decision, role change, etc.</li>
          <li>Resend dashboard: email delivery status per send</li>
          <li>Email Kevin (he built it): info@everybooking.com</li>
        </ul>
      ),
    },
  ];

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Reference</span>
          <h1 className="ra-h1">Admin help</h1>
          <p className="ra-quiet">How everything in this portal works, with examples for the weird cases.</p>
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 760 }}>
        {sections.map((s, i) => (
          <details
            key={i}
            open={i < 2}
            className="ra-card"
            style={{ padding: "1rem 1.25rem" }}
          >
            <summary style={{
              cursor: "pointer", listStyle: "none",
              fontFamily: "var(--font-display)", fontSize: "1.15rem", fontWeight: 500,
              color: "var(--ra-ink)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              {s.title}
              <span className="ra-tiny">▾</span>
            </summary>
            <div style={{ marginTop: "0.85rem", fontSize: "0.92rem", lineHeight: 1.65, color: "var(--ra-ink-soft)" }}>
              {s.body}
            </div>
          </details>
        ))}
      </div>

      <div style={{ marginTop: "2.5rem" }}>
        <Link href="/admin" className="ra-link">← Back to dashboard</Link>
      </div>
    </div>
  );
}
