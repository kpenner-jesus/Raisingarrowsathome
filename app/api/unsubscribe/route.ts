// GET /api/unsubscribe?token=...
// One-click unsubscribe via HMAC-signed token.
//
// Token payload formats:
//   - "unsub:<orgId>:<email>"  (preferred — multi-tenant, since 2026-05-25)
//   - "unsub:<email>"          (legacy, falls back to resolving tenant via host)
//
// On success: writes email_optouts row scoped to the tenant + renders
// confirmation HTML. Always returns 200 so email clients don't flag/retry.
import { NextResponse } from "next/server";
import { verifyToken } from "@/app/lib/hmac";
import { supabaseService } from "@/app/lib/supabase/server";
import { getOrgContext } from "@/app/lib/org-context";

export const dynamic = "force-dynamic";

function page(orgName: string, body: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title>
      <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:48px auto;padding:0 20px;color:#1a1a1a;line-height:1.6;}h1{font-family:Georgia,serif;color:#e8793a;font-size:1.5rem;font-style:italic;}a{color:#666;}</style>
     </head><body><h1>${orgName}</h1>${body}</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

/** Parse "unsub:<orgId>:<email>" or legacy "unsub:<email>". */
function parseUnsubPayload(payload: string): { orgId: string | null; email: string } | null {
  if (!payload.startsWith("unsub:")) return null;
  const rest = payload.slice("unsub:".length);
  // UUID has dashes but not colons; the only colon allowed in an email
  // address is technically possible only in IPv6 literal hosts which
  // we'll never see in practice — first ':' splits orgId from email.
  const idx = rest.indexOf(":");
  if (idx === -1) {
    // Legacy format — just an email.
    return { orgId: null, email: rest.toLowerCase() };
  }
  const orgId = rest.slice(0, idx);
  const email = rest.slice(idx + 1).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    // Doesn't look like a UUID; treat whole rest as legacy email.
    return { orgId: null, email: rest.toLowerCase() };
  }
  return { orgId, email };
}

export async function GET(req: Request) {
  // Resolve org from host as a fallback for legacy tokens or to render
  // the correct org name in the confirmation page.
  const orgCtx = await getOrgContext();
  const orgName = orgCtx?.name ?? "Raising Arrows";

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return page(orgName, `<p>Missing unsubscribe token. <a href="/">Back to website</a>.</p>`);

  const v = verifyToken(token);
  if (!v.ok) {
    return page(orgName, `<p>This unsubscribe link is invalid or has expired. Email <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a> and we'll remove you manually.</p>`);
  }

  const parsed = parseUnsubPayload(v.payload);
  if (!parsed) {
    return page(orgName, `<p>Wrong link type.</p>`);
  }

  // Choose tenant: prefer the orgId baked into the token, fall back to the
  // host-resolved tenant. If we have neither, refuse — we will not insert
  // an org-less email_optouts row (the column is NOT NULL anyway).
  const orgId = parsed.orgId ?? orgCtx?.id ?? null;
  if (!orgId) {
    return page(orgName, `<p>This unsubscribe link can't be processed on this host. Email <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a> and we'll remove you manually.</p>`);
  }

  const svc = supabaseService();
  // email_optouts PK is now (org_id, email) — opt-outs are per-tenant, so an
  // unsubscribe from tenant A no longer suppresses tenant B's mail to the same
  // address. Upsert on the composite key.
  await svc.from("email_optouts").upsert(
    { org_id: orgId, email: parsed.email, scope: "broadcasts" },
    { onConflict: "org_id,email" }
  );

  return page(orgName, `<p>You've been unsubscribed from program broadcasts at <strong>${parsed.email}</strong>.</p>
    <p>You'll still receive transactional messages tied to your active grant (receipt decisions, payouts) if you're a recipient — those are part of the program itself.</p>
    <p>Email <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a> if you want to re-subscribe.</p>
    <p><a href="/">Back to website</a></p>`);
}

// Also accept POST for List-Unsubscribe-Post one-click clients (Gmail/Apple Mail).
export async function POST(req: Request) {
  return GET(req);
}
