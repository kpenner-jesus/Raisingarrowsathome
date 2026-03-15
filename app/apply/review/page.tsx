"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import emailjs from "@emailjs/browser";
import { useAppStore } from "../../store";
import { SITE_CONFIG } from "../../siteConfig";
import { EMAIL_KEYS } from "../../emailKeys";

// ── GOOGLE SHEETS WEBHOOK ────────────────────────────────────
// To enable Google Sheets logging:
// 1. Go to sheets.google.com and create a new sheet
// 2. Extensions → Apps Script → paste the webhook code below
// 3. Deploy as Web App → copy the URL → paste it here
// 4. Full Apps Script code is in the comment at the bottom of this file
const SHEETS_WEBHOOK_URL = process.env.NEXT_PUBLIC_SHEETS_WEBHOOK_URL ?? "";

export default function ReviewPage() {
  const router  = useRouter();
  const store   = useAppStore((s) => s);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState("");

  const progress = 100;

  // ── BUILD EMAIL CONTENT ──────────────────────────────────
  const childrenSummary = store.children
    .map((c, i) => `Child ${i + 1}: Age ${c.age}, ${c.grade}`)
    .join("\n");

  const questionsSummary = SITE_CONFIG.questions
    .map((q) => {
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
      return `Q: ${q.question}\nA: ${answers[q.key] || "—"}`;
    })
    .join("\n\n");

  // ── FUNDING CAP ESTIMATE ─────────────────────────────────
  const estimatedFunding = store.children.reduce((total, child) => {
    const cap = SITE_CONFIG.fundingCaps.find((tier) => {
      const [min, max] = tier.label.replace("Ages ", "").split("–").map(Number);
      return child.age >= min && child.age <= max;
    });
    return total + (cap?.cap ?? 0);
  }, 0);

  // ── SUBMIT APPLICATION ───────────────────────────────────
  const handleSubmit = () => {
    setSending(true);
    setError("");

    const appRef = `RA-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${store.parentNames.split(" ")[0].toUpperCase()}`;

    const params = {
      // Contact
      parent_names:   store.parentNames,
      city:           store.city,
      contact_email:  store.contactEmail,
      contact_phone:  store.contactPhone,
      income_range:   store.incomeRange,
      app_ref:        appRef,
      date:           new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }),

      // Children
      children_summary: childrenSummary,
      num_children:     String(store.children.length),
      estimated_funding: `$${estimatedFunding}`,

      // Current situation
      current_schooling: store.currentSchooling,

      // All 9 questions
      why_homeschool:           store.whyHomeschool,
      biggest_concern:          store.biggestConcern,
      educational_goals:        store.educationalGoals,
      what_grant_makes_possible: store.whatGrantMakesPossible,
      single_income:            store.singleIncome,
      christian_faith:          store.christianFaith,
      local_church:             store.localChurch,
      curriculum_considering:   store.curriculumConsidering,
      how_grant_helps:          store.howGrantHelps,

      // Full summary for email body
      questions_summary: questionsSummary,

      // Video
      video_link: store.videoLink,

      // Org info
      org_name:  SITE_CONFIG.orgName,
      org_email: SITE_CONFIG.orgEmail,

      // For routing
      to_email:  SITE_CONFIG.orgEmail,
      reply_to:  store.contactEmail,
    };

    // Initialize EmailJS
    emailjs.init({ publicKey: EMAIL_KEYS.PUBLIC_KEY });

    // Send org notification then guest confirmation
    emailjs.send(EMAIL_KEYS.SERVICE_ID, EMAIL_KEYS.TEMPLATE_ID, params)
      .then(() => {
        // Guest confirmation
        if (EMAIL_KEYS.GUEST_TEMPLATE_ID) {
          return emailjs.send(
            EMAIL_KEYS.SERVICE_ID,
            EMAIL_KEYS.GUEST_TEMPLATE_ID,
            { ...params, to_email: store.contactEmail }
          );
        }
      })
      .then(() => {
        // Google Sheets logging
        if (SHEETS_WEBHOOK_URL) {
          fetch(SHEETS_WEBHOOK_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              app_ref:          appRef,
              date:             params.date,
              parent_names:     store.parentNames,
              city:             store.city,
              email:            store.contactEmail,
              phone:            store.contactPhone,
              income_range:     store.incomeRange,
              num_children:     store.children.length,
              children:         childrenSummary,
              estimated_funding: estimatedFunding,
              video_link:       store.videoLink,
              current_schooling: store.currentSchooling,
              why_homeschool:   store.whyHomeschool,
              biggest_concern:  store.biggestConcern,
              educational_goals: store.educationalGoals,
              what_grant_makes_possible: store.whatGrantMakesPossible,
              single_income:    store.singleIncome,
              christian_faith:  store.christianFaith,
              local_church:     store.localChurch,
              curriculum:       store.curriculumConsidering,
              how_grant_helps:  store.howGrantHelps,
            }),
          }).catch(() => {}); // Fail silently — email is the primary record
        }
        store.resetApplication();
        router.push("/apply/success");
      })
      .catch((err: any) => {
        setSending(false);
        console.error("Submit error:", err);
        setError(`Submission failed: ${err?.text || err?.message || "unknown error"}. Please email us directly at ${SITE_CONFIG.orgEmail}`);
      });
  };

  // ── SECTION COMPONENT ────────────────────────────────────
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

        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <div className="tf-step-label" style={{ marginBottom: "0.5rem" }}>
            Final step — Review your application
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.6rem, 4vw, 2.2rem)", fontWeight: 500, marginBottom: "0.5rem" }}>
            Does everything look <em style={{ color: "var(--accent)" }}>correct</em>?
          </h1>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 300, lineHeight: 1.6 }}>
            Review your answers below. Click any section to go back and edit.
          </p>
        </div>

        {/* Family info */}
        <Section title="Family Information">
          <Field label="Parent name(s)" value={store.parentNames} />
          <Field label="City / Town" value={store.city} />
          <Field label="Current schooling" value={store.currentSchooling} />
          <Field label="Contact email" value={store.contactEmail} />
          <Field label="Phone" value={store.contactPhone} />
          <Field label="Income range" value={store.incomeRange} />
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              Children
            </div>
            {store.children.map((child, i) => (
              <div key={i} style={{
                display: "flex", gap: "1rem", fontSize: "0.875rem",
                color: "var(--text-primary)", marginBottom: "0.3rem",
              }}>
                <span style={{ color: "var(--text-muted)" }}>Child {i + 1}:</span>
                <span>Age {child.age} · {child.grade}</span>
              </div>
            ))}
          </div>
          {estimatedFunding > 0 && (
            <div style={{
              background: "rgba(232,121,58,0.08)", border: "1px solid rgba(232,121,58,0.2)",
              borderRadius: "var(--radius-sm)", padding: "0.6rem 0.875rem", marginTop: "0.5rem",
            }}>
              <span style={{ fontSize: "0.8rem", color: "var(--accent)", fontWeight: 500 }}>
                Estimated maximum grant: ${estimatedFunding}
              </span>
            </div>
          )}
        </Section>

        {/* Edit family button */}
        <button onClick={() => router.push("/apply/family")}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "var(--font-body)", marginBottom: "1.25rem", display: "block" }}>
          ✎ Edit family information
        </button>

        {/* Written questions */}
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

        {/* Video */}
        <Section title="Video Interview">
          <Field label="Video link" value={store.videoLink} link={true} />
        </Section>

        <button onClick={() => router.push("/apply/video")}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "var(--font-body)", marginBottom: "2rem", display: "block" }}>
          ✎ Edit video link
        </button>

        {/* Disclaimer */}
        <div style={{
          background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: "var(--radius-md)", padding: "1rem 1.25rem", marginBottom: "1.5rem",
          fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.7,
        }}>
          By submitting this application you confirm that all information provided
          is accurate and that your family has never previously registered with
          the government for homeschooling any of your children.
        </div>

        {error && (
          <div className="tf-alert-error" style={{ marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        {/* Submit */}
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

/*
============================================================
GOOGLE APPS SCRIPT WEBHOOK CODE
============================================================
To set up Google Sheets logging:

1. Create a new Google Sheet
2. Click Extensions → Apps Script
3. Delete all existing code and paste this:

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data  = JSON.parse(e.postData.contents);

    // Add header row if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Ref", "Date", "Parent Names", "City", "Email", "Phone",
        "Income Range", "# Children", "Children", "Est. Funding",
        "Current Schooling", "Video Link",
        "Why Homeschool", "Biggest Concern", "Educational Goals",
        "What Grant Makes Possible", "Single Income", "Christian Faith",
        "Local Church", "Curriculum", "How Grant Helps"
      ]);
    }

    sheet.appendRow([
      data.app_ref, data.date, data.parent_names, data.city,
      data.email, data.phone, data.income_range,
      data.num_children, data.children, data.estimated_funding,
      data.current_schooling, data.video_link,
      data.why_homeschool, data.biggest_concern, data.educational_goals,
      data.what_grant_makes_possible, data.single_income,
      data.christian_faith, data.local_church, data.curriculum,
      data.how_grant_helps
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ result: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: "error", error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

4. Click Deploy → New Deployment
5. Type: Web App
6. Execute as: Me
7. Who has access: Anyone
8. Click Deploy → copy the Web App URL
9. Add it to Vercel environment variables as:
   NEXT_PUBLIC_SHEETS_WEBHOOK_URL = https://script.google.com/macros/s/YOUR_ID/exec
============================================================
*/
