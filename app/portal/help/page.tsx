import Link from "next/link";

export const dynamic = "force-dynamic";

export default function PortalHelp() {
  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: "How does the grant work?",
      body: (
        <>
          <p>You buy curriculum, workbooks, and educational books for your homeschool. You upload the receipt here. Once it&apos;s approved, we reimburse part of the cost via e-transfer.</p>
          <p>Your <strong>approved cap</strong> is the maximum we&apos;ll pay you over the lifetime of the grant. Your <strong>reimbursement rate</strong> (usually 75%) is how much of each receipt we cover. So a $100 receipt = $75 reimbursement.</p>
        </>
      ),
    },
    {
      title: "What can I submit receipts for?",
      body: (
        <>
          <p>Curriculum, workbooks, and educational books.</p>
          <p>We do <em>not</em> reimburse field trips, school supplies (pens, paper, notebooks), tutoring, co-op fees, or extracurricular activities.</p>
        </>
      ),
    },
    {
      title: "How do I upload a receipt?",
      body: (
        <ol style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
          <li>Tap <strong>Upload receipt</strong> in the top nav.</li>
          <li>Tap the file picker → take a photo with your phone&apos;s camera, OR pick a picture/PDF from your library.</li>
          <li>Enter the amount + currency (CAD or USD).</li>
          <li>Pick the purchase date.</li>
          <li>Describe what it&apos;s for (e.g. &quot;Sonlight Core A — Amazon.ca&quot;).</li>
          <li>Tap <strong>Submit receipt</strong>.</li>
        </ol>
      ),
    },
    {
      title: "When will I get paid?",
      body: (
        <>
          <p>Payouts run on <strong>the 15th</strong> and <strong>the last day of every month</strong>.</p>
          <p>You need to upload + have receipts approved at least 2 weeks before the payout date:</p>
          <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.7 }}>
            <li>Submit by the <strong>1st</strong> → paid on the <strong>15th</strong></li>
            <li>Submit by the <strong>17th</strong> → paid at <strong>end of month</strong></li>
            <li>Later than that → rolls to the next 15th</li>
          </ul>
          <p>Payouts come from <strong>CEO Ministries</strong> (the registered charity behind Raising Arrows) as an Interac e-transfer.</p>
        </>
      ),
    },
    {
      title: "How long do I have to submit receipts?",
      body: (
        <p>Six months from your acceptance date. Your dashboard shows the exact deadline. After that, no more receipts can be submitted against your grant.</p>
      ),
    },
    {
      title: "I have a US receipt — what do I do?",
      body: (
        <>
          <p>Pick &quot;USD&quot; in the currency dropdown when you upload. We&apos;ll convert it to CAD at the time of approval.</p>
          <p>You don&apos;t need to do the exchange-rate math yourself.</p>
        </>
      ),
    },
    {
      title: "Can I submit a partial receipt?",
      body: (
        <>
          <p>Yes. For example, if a few families shared a Rainbow Resource order, upload the full receipt and tell us in the description which part is yours. The reviewer will reimburse just your share.</p>
        </>
      ),
    },
    {
      title: "What about photos?",
      body: (
        <>
          <p>Tap <strong>Photos</strong> in the top nav to share moments from your homeschool journey — books in action, a reading nook, a milestone moment. Photos are optional and aren&apos;t tied to reimbursement, but they help us tell your family&apos;s story.</p>
        </>
      ),
    },
    {
      title: "What about testimonials?",
      body: (
        <p>Tap <strong>Testimonials</strong> in the top nav to share how things are going. We may share excerpts to encourage other families considering homeschooling.</p>
      ),
    },
    {
      title: "Something went wrong / I have a question",
      body: (
        <p>Email <a href="mailto:register@raisingarrowsathome.com" style={{ color: "var(--accent)" }}>register@raisingarrowsathome.com</a>.</p>
      ),
    },
  ];

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", marginBottom: "0.5rem" }}>How this works</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.6 }}>
        Everything you need to know about your Raising Arrows grant. Each card below answers a common question.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {sections.map((s, i) => (
          <details
            key={i}
            open={i < 3}
            style={{
              background: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 10,
              padding: "1rem 1.25rem",
            }}
          >
            <summary style={{
              cursor: "pointer", listStyle: "none",
              fontFamily: "var(--font-display)", fontSize: "1.1rem",
              fontWeight: 500, color: "var(--text-primary)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              {s.title}
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>▾</span>
            </summary>
            <div style={{
              marginTop: "0.75rem", fontSize: "0.92rem", color: "var(--text-primary)", lineHeight: 1.65,
            }}>
              {s.body}
            </div>
          </details>
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: "2.5rem" }}>
        <Link href="/portal" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
