// /admin/settings — hub. Links to every settings sub-area.
//
// Sub-areas:
//   /admin/settings/program       — funding caps, reimbursement rate, deadline, intake
//   /admin/settings/billing       — subscription + Stripe portal
//   /admin/settings/branding      — logo + accent colour (planned)
//   /admin/settings/email-domain  — verify per-tenant sending domain

import Link from "next/link";
import { getOrgContext, orgPath } from "@/app/lib/org-context";

export const dynamic = "force-dynamic";

type Card = { href: string; title: string; description: string; glyph: string };

export default async function SettingsHub() {
  const ctx = await getOrgContext();
  const op = (p: string) => orgPath(ctx, p);

  const cards: Card[] = [
    {
      href:  op("/admin/settings/program"),
      glyph: "⚙",
      title: "Program controls",
      description: "Funding caps, reimbursement rate, submission deadline, intake open/closed status.",
    },
    {
      href:  op("/admin/settings/billing"),
      glyph: "$",
      title: "Billing",
      description: "Subscription state, trial countdown, Stripe checkout for upgrade.",
    },
    {
      href:  op("/admin/settings/email-domain"),
      glyph: "@",
      title: "Sending domain",
      description: "Verify your own domain so emails come from you instead of the shared platform sender.",
    },
    {
      href:  op("/admin/settings/branding"),
      glyph: "✦",
      title: "Branding",
      description: "Upload your logo + pick an accent colour. Coming soon.",
    },
    {
      href:  op("/admin/settings/ai"),
      glyph: "✧",
      title: "AI assistant",
      description: "Use your own OpenRouter key + pick the model the assistant runs on. Falls back to the platform model when unset.",
    },
  ];

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Configuration</span>
          <h1 className="ra-h1">Settings</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Everything that controls how your portal looks + behaves.
          </p>
        </div>
      </header>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "1rem",
        marginTop: "0.5rem",
      }}>
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              display: "block",
              background: "rgba(255,255,255,0.85)",
              border: "1.5px solid rgba(0,0,0,0.08)",
              borderRadius: 14,
              padding: "1.25rem 1.25rem",
              textDecoration: "none",
              color: "inherit",
              transition: "background 0.15s, border-color 0.15s, transform 0.05s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
              <span style={{
                width: 40, height: 40, borderRadius: 10,
                display: "grid", placeItems: "center",
                background: "rgba(232,121,58,0.12)",
                color: "var(--ra-accent, #e8793a)",
                fontSize: "1.2rem", fontWeight: 600,
              }}>{c.glyph}</span>
              <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>{c.title}</div>
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.92rem", lineHeight: 1.55 }}>
              {c.description}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
