"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../store";
import { SITE_CONFIG } from "../../siteConfig";

const SHEETS_WEBHOOK_URL = process.env.NEXT_PUBLIC_SHEETS_WEBHOOK_URL ?? "";

/**
 * Turn a rejected submission into something a family can act on.
 *
 * The API replies with short plain-text bodies. A few of them ("applications
 * are currently closed") are already written for a human; the rest are
 * internal ("no tenant resolved for this host") and must not be shown as-is.
 * Every branch says the same two things: your application was NOT sent, and
 * here is what to do next.
 */
function submitErrorMessage(status: number, detail: string, contactEmail: string): string {
  const emailUs = `email us at ${contactEmail}`;

  if (status === 403) {
    return `Applications are closed at the moment, so this one hasn't been sent. Please ${emailUs} and we'll let you know when the next round opens.`;
  }
  if (status === 429) {
    // The server writes this copy for families, and it distinguishes "we
    // already have an application from this address" from "too many from your
    // network". Prefer it — but only when it is plainly our own plain-text
    // body, since a CDN or platform-level 429 returns an HTML page.
    const ours = detail.trim();
    if (ours && ours.length <= 400 && !ours.includes("<")) return ours;
    return `We've had a lot of submissions come in at once, so we couldn't accept this one just yet. Please wait a few minutes and press Submit again — your answers are still here.`;
  }
  if (status === 400 && /missing required/i.test(detail)) {
    return `Your name and contact email are both needed before we can accept the application. Please use the edit links above to fill them in.`;
  }
  return `Something went wrong on our end and your application has NOT been sent. Please try again in a moment — your answers are still here. If it happens again, ${emailUs} and we'll take it from there.`;
}

export default function ReviewPage() {
  const router  = useRouter();
  const store   = useAppStore((s) => s);
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState("");
  // Honeypot. Must stay in sync with HONEYPOT_FIELD in
  // app/lib/submit-throttle-logic.ts — that module is server-only (it pulls in
  // node crypto), so the name is repeated here rather than imported.
  const [botField, setBotField] = useState("");

  const progress = 100;

  const childrenSummary = store.children
    .map((c, i) => `Child ${i + 1}: Age ${c.age}, ${c.grade}`)
    .join("\n");

  const estimatedFunding = store.children.reduce((total, child) => {
    const cap = SITE_CONFIG.fundingCaps.find((tier) => {
      const [min, max] = tier.label.replace("Ages ", "").split("–").map(Number);
      return child.age >= min && child.age <= max;
    });
    return total + (cap?.cap ?? 0);
  }, 0);

  // The SERVER decides whether an application was received.
  //
  // It used to be EmailJS. The redirect to /apply/success fired from the mail
  // promise, while the database write was fire-and-forget with only a
  // console.error — so a family whose application failed to save was still
  // shown the success page, and nobody found out. The save is now awaited and
  // it alone decides what the family sees.
  const handleSubmit = async () => {
    if (sending) return;            // guard synchronously; `disabled` alone races
    setSending(true);
    setError("");

    let res: Response;
    try {
      res = await fetch("/api/applications/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // app_ref is deliberately NOT sent: the server generates the
          // authoritative one and the client's copy was being ignored.
          company_website: botField,
          parent_names: store.parentNames,
          city: store.city,
          contact_email: store.contactEmail,
          contact_phone: store.contactPhone,
          income_range: store.incomeRange,
          current_schooling: store.currentSchooling,
          address_street: store.addressStreet,
          address_province: store.addressProvince,
          address_postal: store.addressPostal,
          mail_consent: store.mailConsent,
          children: store.children,
          answers: {
            whyHomeschool:          store.whyHomeschool,
            biggestConcern:         store.biggestConcern,
            educationalGoals:       store.educationalGoals,
            whatGrantMakesPossible: store.whatGrantMakesPossible,
            singleIncome:           store.singleIncome,
            christianFaith:         store.christianFaith,
            localChurch:            store.localChurch,
            curriculumConsidering:  store.curriculumConsidering,
            howGrantHelps:          store.howGrantHelps,
          },
          video_link: store.videoLink,
        }),
      });
    } catch (err) {
      // Network-level failure — offline, DNS, connection dropped mid-flight.
      console.error("[apply] submit request never completed:", err);
      setSending(false);
      setError(
        `We couldn't reach our server, so your application has NOT been sent. ` +
        `Please check your connection and press Submit again — your answers are still here. ` +
        `If it keeps failing, email us at ${SITE_CONFIG.orgEmail}.`
      );
      return;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[apply] submit rejected:", res.status, detail);
      setSending(false);
      setError(submitErrorMessage(res.status, detail, SITE_CONFIG.orgEmail));
      // Deliberately NOT resetting the store — a retry must not mean typing
      // the whole application again.
      return;
    }

    const saved = (await res.json().catch(() => ({}))) as { app_ref?: string };

    // Optional Google Sheets mirror. Now fed the app_ref the SERVER generated:
    // the client used to invent its own shorter reference, so the sheet and the
    // database have been recording different numbers for the same application.
    if (SHEETS_WEBHOOK_URL) {
      fetch(SHEETS_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_ref:                   saved.app_ref ?? "",
          date:                      new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }),
          parent_names:              store.parentNames,
          city:                      store.city,
          email:                     store.contactEmail,
          phone:                     store.contactPhone,
          income_range:              store.incomeRange,
          num_children:              store.children.length,
          children:                  childrenSummary,
          estimated_funding:         estimatedFunding,
          video_link:                store.videoLink,
          current_schooling:         store.currentSchooling,
          why_homeschool:            store.whyHomeschool,
          biggest_concern:           store.biggestConcern,
          educational_goals:         store.educationalGoals,
          what_grant_makes_possible: store.whatGrantMakesPossible,
          single_income:             store.singleIncome,
          christian_faith:           store.christianFaith,
          local_church:              store.localChurch,
          curriculum:                store.curriculumConsidering,
          how_grant_helps:           store.howGrantHelps,
        }),
      }).catch(() => {});
    }

    store.resetApplication();
    router.push("/apply/success");
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{
      background: "rgba(255,255,255,0.72)",
      border: "1.5px solid rgba(0,0,0,0.09)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      boxShadow: "var(--shadow-card)",
      marginBottom: "0.875rem",
    }}>
      <div style={{
        padding: "0.6rem 1.25rem",
        background: "rgba(0,0,0,0.025)",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        fontSize: "0.7rem", fontWeight: 700,
        letterSpacing: "0.1em", textTransform: "uppercase" as const,
        color: "var(--text-muted)",
      }}>
        {title}
      </div>
      <div style={{ padding: "1rem 1.25rem" }}>
        {children}
      </div>
    </div>
  );

  const Field = ({ label, value, link }: { label: string; value: string; link?: boolean }) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--text-muted)", marginBottom: "0.2rem" }}>
        {label}
      </div>
      {link ? (
        <a href={value} target="_blank" rel="noreferrer"
          style={{ fontSize: "0.875rem", color: "var(--accent)", wordBreak: "break-all" as const }}>
          {value}
        </a>
      ) : (
        <div style={{ fontSize: "0.875rem", color: "var(--text-primary)", lineHeight: 1.6, whiteSpace: "pre-wrap" as const }}>
          {value || "—"}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)", padding: "2rem 1.5rem 6rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        <div style={{ marginBottom: "2rem" }}>
          <div className="tf-step-label" style={{ marginBottom: "0.5rem" }}>
            Final step — Review your application
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.6rem, 4vw, 2.2rem)", fontWeight: 500, marginBottom: "0.5rem" }}>
            Does everything look <em style={{ color: "var(--accent)" }}>correct</em>?
          </h1>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 300, lineHeight: 1.6 }}>
            Review your answers below. Click any edit link to go back and change something.
          </p>
        </div>

        <Section title="Family Information">
          <Field label="Parent name(s)" value={store.parentNames} />
          <Field label="City / Town" value={store.city} />
          <Field label="Current schooling" value={store.currentSchooling} />
          <Field label="Contact email" value={store.contactEmail} />
          <Field label="Phone" value={store.contactPhone} />
          <Field label="Income range" value={store.incomeRange} />
          <Field
            label="Mailing address"
            value={[store.addressStreet, store.city, store.addressProvince, store.addressPostal]
              .filter(Boolean).join(", ")}
          />
          <Field
            label="Mail from CEO Ministries"
            value={store.mailConsent
              ? "Yes — happy to receive ministry mail at this address"
              : "Not opted in (this does not affect the application)"}
          />
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              Children
            </div>
            {store.children.map((child, i) => (
              <div key={i} style={{ display: "flex", gap: "1rem", fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "0.3rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Child {i + 1}:</span>
                <span>Age {child.age} · {child.grade}</span>
              </div>
            ))}
          </div>
          {estimatedFunding > 0 && (
            <div style={{ background: "rgba(232,121,58,0.08)", border: "1px solid rgba(232,121,58,0.2)", borderRadius: "var(--radius-sm)", padding: "0.6rem 0.875rem", marginTop: "0.5rem" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--accent)", fontWeight: 500 }}>
                Estimated maximum grant: ${estimatedFunding}
              </span>
            </div>
          )}
        </Section>

        <button onClick={() => router.push("/apply/family")}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "var(--font-body)", marginBottom: "1.25rem", display: "block" }}>
          ✎ Edit family information
        </button>

        <Section title="Written Questions">
          {SITE_CONFIG.questions.map((q, i) => {
            const answers: Record<string, string> = {
              whyHomeschool:          store.whyHomeschool,
              biggestConcern:         store.biggestConcern,
              educationalGoals:       store.educationalGoals,
              whatGrantMakesPossible: store.whatGrantMakesPossible,
              singleIncome:           store.singleIncome,
              christianFaith:         store.christianFaith,
              localChurch:            store.localChurch,
              curriculumConsidering:  store.curriculumConsidering,
              howGrantHelps:          store.howGrantHelps,
            };
            return (
              <div key={i} style={{ marginBottom: i < SITE_CONFIG.questions.length - 1 ? "1.25rem" : 0 }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.3rem" }}>
                  Q{i + 1}: {q.question}
                </div>
                <div style={{ fontSize: "0.875rem", color: "var(--text-primary)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                  {answers[q.key] || "—"}
                </div>
              </div>
            );
          })}
        </Section>

        <button onClick={() => router.push("/apply/questions/0")}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "var(--font-body)", marginBottom: "1.25rem", display: "block" }}>
          ✎ Edit written answers
        </button>

        <Section title="Video Interview">
          <Field label="Video link" value={store.videoLink} link={true} />
        </Section>

        <button onClick={() => router.push("/apply/video")}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "var(--font-body)", marginBottom: "2rem", display: "block" }}>
          ✎ Edit video link
        </button>

        <div style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: "var(--radius-md)", padding: "1rem 1.25rem", marginBottom: "1.5rem", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
          By submitting this application you confirm that all information provided
          is accurate and that your family has never previously registered with
          the government for homeschooling any of your children.
        </div>

        {/* Honeypot: positioned off-screen rather than display:none, which
            some bots skip. Out of the tab order and out of the accessibility
            tree, and named so a password manager won't autofill it. */}
        <input
          type="text"
          name="company_website"
          value={botField}
          onChange={(e) => setBotField(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />

        {error && (
          <div className="tf-alert-error" style={{ marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        <button className="tf-ok" onClick={handleSubmit} disabled={sending}
          style={{ width: "100%", justifyContent: "center", fontSize: "1rem", padding: "1rem" }}>
          {sending ? "Submitting…" : "Submit Application"}
          {!sending && (
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>

        <button className="tf-back" onClick={() => router.push("/apply/contact")}
          style={{ marginTop: "0.75rem", display: "block" }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
