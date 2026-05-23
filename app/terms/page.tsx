import Link from "next/link";

export const metadata = {
  title: "Terms",
  description: "The rules of using the Raising Arrows portal and accepting a grant.",
};

export default function TermsPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem 5rem" }}>
        <Link href="/" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>← Back to website</Link>

        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem", fontWeight: 500, marginTop: "1.5rem", marginBottom: "0.5rem" }}>Terms</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>Last updated 2026-05-23</p>

        <Section title="Who we are">
          <p>Raising Arrows is a homeschool-grant ministry serving Christian families in Manitoba in their first year of homeschooling. Grants are disbursed by our registered-charity sponsor, <strong>CEO Ministries</strong>. Donations and reimbursements flow through CEO Ministries' charitable accounts.</p>
        </Section>

        <Section title="Who can apply">
          <p>To be eligible you must:</p>
          <ul>
            <li>Live in Manitoba.</li>
            <li>Be beginning home-based education for the first time (this is a first-year-only grant).</li>
            <li>Be a Christian family — we welcome families across Christian traditions.</li>
            <li>Have school-aged children (5–18) being educated at home.</li>
          </ul>
          <p>Final eligibility decisions rest with the Raising Arrows administrators and CEO Ministries.</p>
        </Section>

        <Section title="What you get if approved">
          <p>If your application is approved you receive a <strong>grant cap</strong> based on your children's ages (typically $375–$750). We reimburse <strong>75% of qualifying receipts</strong> up to that cap. Submission window is six months from approval unless we extend it for you in writing.</p>
        </Section>

        <Section title="Qualifying expenses">
          <p>Reimbursable: <strong>curriculum, workbooks, and educational books</strong>. That&apos;s it — we keep the scope tight so receipts are easy to verify.</p>
          <p>Not reimbursable: field trips, school supplies (paper, pens, notebooks), technology (tablets, laptops), furniture, extracurricular fees, tutoring, co-op fees, food, second-copy curriculum, and anything else not a curriculum, workbook, or educational book.</p>
          <p className="ra-quiet" style={{ fontSize: "0.9rem" }}>If you&apos;re unsure whether something qualifies, email <a href="mailto:register@raisingarrowsathome.com" style={{ color: "var(--accent)" }}>register@raisingarrowsathome.com</a> <em>before</em> you purchase.</p>
        </Section>

        <Section title="How reimbursement works">
          <p>You upload a receipt photo + amount to your portal. We review within 5 business days and either approve or reject with a reason. Approved receipts roll into bi-monthly payouts (the 15th and the last day). CEO Ministries sends the e-transfer to the email on file.</p>
          <p>Currency: CAD receipts are reimbursed directly. USD receipts require an explicit reimbursable-CAD amount which we set when approving.</p>
        </Section>

        <Section title="Your obligations">
          <ul>
            <li>Submit only receipts for materials you actually purchased for your own household's use.</li>
            <li>Do not double-claim against other grants or tax credits without telling us.</li>
            <li>Keep your portal contact email + address current so payouts reach you.</li>
            <li>If you withdraw from homeschooling during the year, please let us know so we can close your file fairly.</li>
          </ul>
        </Section>

        <Section title="Our obligations">
          <ul>
            <li>Treat your application + financial information confidentially (see <Link href="/privacy" style={{ color: "var(--accent)" }}>Privacy</Link>).</li>
            <li>Review your receipts within 5 business days.</li>
            <li>Pay out approved reimbursements within 1–3 business days of the scheduled batch date.</li>
            <li>Notify you in writing if program rules change.</li>
          </ul>
        </Section>

        <Section title="Photos + testimonials">
          <p>Uploading a photo or testimonial to the portal gives Raising Arrows permission to use it (without identifying child faces) in our annual report, newsletters, and on this website. You can request removal at any time by emailing us.</p>
        </Section>

        <Section title="Suspension">
          <p>We may suspend a grant if we believe receipts have been falsified, double-claimed, or the program is otherwise being misused. We will tell you why and give you a chance to respond before any permanent action.</p>
        </Section>

        <Section title="Disclaimer">
          <p>Raising Arrows is a ministry, not a contract for services. We do not guarantee any specific funding level beyond what we have approved in writing. CEO Ministries reserves the right to adjust the program in response to donor restrictions or CRA guidance.</p>
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
