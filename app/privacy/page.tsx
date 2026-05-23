import Link from "next/link";

export const metadata = {
  title: "Privacy",
  description: "How Raising Arrows handles the information families share with us.",
};

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem 5rem" }}>
        <Link href="/" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>← Back to website</Link>

        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem", fontWeight: 500, marginTop: "1.5rem", marginBottom: "0.5rem" }}>Privacy</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>Last updated 2026-05-23</p>

        <Section title="What we collect">
          <p>To process a homeschool grant we collect: parent names, mailing address, email, phone, household income range, names + ages of school-age children, schooling history, written application answers, optional video link, uploaded receipts, photos, and testimonials you submit through the portal.</p>
        </Section>

        <Section title="Why we collect it">
          <p>We use this information to:</p>
          <ul>
            <li>Decide who qualifies for a Raising Arrows grant.</li>
            <li>Process reimbursements via e-transfer through our sponsor, CEO Ministries.</li>
            <li>Meet our reporting obligations to CEO Ministries and to the Canada Revenue Agency as a registered charity ministry.</li>
            <li>Stay in touch with you about your active grant (approvals, receipt decisions, payouts).</li>
          </ul>
        </Section>

        <Section title="Who can see it">
          <p>Only:</p>
          <ul>
            <li><strong>You</strong>, signed into your portal.</li>
            <li><strong>The two Raising Arrows administrators</strong> (currently Jordan and Tierza Hammond) and the small accounting team at CEO Ministries that processes the e-transfers.</li>
            <li><strong>Auditors and CRA inspectors</strong> if a charity audit requires it.</li>
          </ul>
          <p>We do not sell, rent, or share your information with marketers or third parties for any purpose other than running the grant program.</p>
        </Section>

        <Section title="Where it lives">
          <p>Data lives in two services:</p>
          <ul>
            <li><strong>Supabase</strong> (Postgres database + file storage) for applications, receipts, photos, testimonials.</li>
            <li><strong>Resend</strong> for the outbound emails you receive from us.</li>
          </ul>
          <p>Both providers store data on servers in North America. Access is restricted by row-level-security policies and admin authentication.</p>
        </Section>

        <Section title="How long we keep it">
          <p>Approved-recipient records are kept for as long as the Canada Revenue Agency requires a registered charity to keep them (currently the year of the donation plus six years). Denied applications are kept for one year and then deleted. You may request earlier deletion of denied-application data by emailing <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a>.</p>
        </Section>

        <Section title="Your rights">
          <p>You can:</p>
          <ul>
            <li>See everything we hold on you from your portal.</li>
            <li>Request a correction (email us).</li>
            <li>Request export of your data in machine-readable form.</li>
            <li>Request deletion (subject to CRA retention rules above).</li>
            <li>Stop the program at any time — your active grant ends and we close your file.</li>
          </ul>
        </Section>

        <Section title="Cookies + sign-in">
          <p>We use a single Supabase session cookie when you are signed in to your portal. No tracking, advertising, or third-party analytics cookies are set by this site.</p>
        </Section>

        <Section title="Children's data">
          <p>We do not collect any data <em>from</em> children. We collect their first names and ages as part of your application <em>about</em> them, supplied by you as the parent. This information is used only for funding-tier calculation and is not shown publicly.</p>
        </Section>

        <Section title="Questions?">
          <p>Email <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a>.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 500, marginBottom: "0.6rem", color: "var(--accent)" }}>{title}</h2>
      <div style={{ lineHeight: 1.7, color: "var(--text-primary)" }}>{children}</div>
    </section>
  );
}
