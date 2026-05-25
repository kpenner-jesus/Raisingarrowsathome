// /platform-terms — terms for organizations using the Raising Arrows
// Platform as a SaaS (NOT the Raising Arrows charity itself, which has
// its own privacy/terms at /privacy + /terms).
//
// This is "good faith MVP" copy — not legal advice. Recommend a real
// lawyer review before charging meaningful revenue.

import Link from "next/link";

export const metadata = {
  title: "Platform terms",
  description: "Terms of use for organizations using the Raising Arrows Platform to run their own grant program.",
};

export default function PlatformTermsPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem 5rem" }}>
        <Link href="/signup" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>← Back to signup</Link>

        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem", fontWeight: 500, marginTop: "1.5rem", marginBottom: "0.5rem" }}>
          Platform terms + privacy
        </h1>
        <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>For organizations using the platform · Last updated 2026-05-25</p>

        <Section title="Who this applies to">
          <p>These terms govern organizations ("you", "your charity") that sign up to run their own grant program on the Raising Arrows Platform. Separate from the <Link href="/terms" style={{ color: "var(--accent)" }}>Raising Arrows charity terms</Link>, which apply to grant recipients of Raising Arrows itself.</p>
        </Section>

        <Section title="What you're agreeing to">
          <p>The Platform provides the software you use to: collect applications, review them, approve grants, track receipts, generate payout batches, send notifications. You remain the data controller for your applicants and recipients. We provide the tools — you operate the program.</p>
        </Section>

        <Section title="Billing">
          <p>$20 USD/month per organization. 14-day free trial, no card required to start. After trial you must add a payment method to keep your portal active. All subscription revenue is donated to Raising Arrows (CRA-registered Canadian charity, sponsored by CEO Ministries).</p>
          <p>You may cancel anytime. Existing data is retained for 60 days after cancellation so you can return; after 60 days we permanently delete your tenant data.</p>
        </Section>

        <Section title="Your data">
          <p>You own your data. We store it in Supabase (US region) on your behalf. We never sell it, never share it with other tenants, never train AI on it without explicit opt-in. Daily backups are encrypted. You can export your data as CSV anytime from <code>/admin/reports</code>.</p>
          <p>Cross-tenant isolation is enforced at the database level (row-level security on every table). A bug or misconfiguration that leaked data across tenants would be treated as a security incident — disclosure within 72 hours.</p>
        </Section>

        <Section title="Your responsibilities">
          <ul>
            <li>You are responsible for compliance with your jurisdiction's privacy + charity law (PIPEDA / GDPR / state charity registration / CRA requirements / etc).</li>
            <li>You are responsible for your own grant decisions. The Platform supports your workflow; it does not make decisions for you.</li>
            <li>If you collect tax-receiptable donations through the Platform, your charity issues the receipts — not the Platform.</li>
            <li>Do not use the Platform to send spam, harass applicants, or distribute illegal content. Three abuse reports → suspended portal.</li>
          </ul>
        </Section>

        <Section title="Email deliverability">
          <p>By default emails send from a shared platform sender. We strongly encourage every tenant to verify their own sending domain in <code>/admin/settings/email-domain</code> so deliverability stays isolated — one tenant's bounce rate doesn't drag yours down.</p>
        </Section>

        <Section title="Service reliability">
          <p>The Platform runs on Vercel + Supabase. Both have ~99.9% uptime SLAs (their measurement, not ours). We don't offer an uptime SLA at the $20 tier — if uptime is critical to your operation, contact us before signing up.</p>
        </Section>

        <Section title="Changes to these terms">
          <p>We may update these terms when we add features, change pricing, or to fix unclear copy. Material changes get 30 days notice via email to the org owner. Continued use after the notice period means acceptance.</p>
        </Section>

        <Section title="Questions">
          <p>Email <a href="mailto:register@raisingarrowsathome.com" style={{ color: "var(--accent)" }}>register@raisingarrowsathome.com</a>. Real human answers within 2 business days.</p>
        </Section>

        <p style={{ marginTop: "3rem", fontSize: "0.85rem", color: "var(--text-muted)", borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: "1.5rem" }}>
          By signing up, you agree to these terms. These are good-faith MVP terms — not legal advice. We recommend you have your own counsel review before accepting any liability through the Platform.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "1.75rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 500, marginBottom: "0.6rem" }}>{title}</h2>
      <div style={{ color: "var(--text-secondary)", lineHeight: 1.7, fontSize: "0.95rem" }}>{children}</div>
    </section>
  );
}
