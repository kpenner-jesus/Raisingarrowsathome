// GET /api/unsubscribe?token=...
// One-click unsubscribe via HMAC-signed token (`unsub:<email>`).
// On success: writes email_optouts row + renders confirmation HTML.
// Always returns 200 so email clients don't flag/retry.
import { NextResponse } from "next/server";
import { verifyToken } from "@/app/lib/hmac";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

function page(body: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title>
      <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:48px auto;padding:0 20px;color:#1a1a1a;line-height:1.6;}h1{font-family:Georgia,serif;color:#e8793a;font-size:1.5rem;font-style:italic;}a{color:#666;}</style>
     </head><body>${body}</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return page(`<h1>Raising Arrows</h1><p>Missing unsubscribe token. <a href="/">Back to website</a>.</p>`);

  const v = verifyToken(token);
  if (!v.ok) {
    return page(`<h1>Raising Arrows</h1>
      <p>This unsubscribe link is invalid or has expired. Email <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a> and we'll remove you manually.</p>`);
  }
  if (!v.payload.startsWith("unsub:")) {
    return page(`<h1>Raising Arrows</h1><p>Wrong link type.</p>`);
  }
  const email = v.payload.slice("unsub:".length).toLowerCase();

  const svc = supabaseService();
  await svc.from("email_optouts").upsert({ email, scope: "broadcasts" }, { onConflict: "email" });

  return page(`<h1>Raising Arrows</h1>
    <p>You've been unsubscribed from program broadcasts at <strong>${email}</strong>.</p>
    <p>You'll still receive transactional messages tied to your active grant (receipt decisions, payouts) if you're a recipient — those are part of the program itself.</p>
    <p>Email <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a> if you want to re-subscribe.</p>
    <p><a href="/">Back to website</a></p>`);
}

// Also accept POST for List-Unsubscribe-Post one-click clients (Gmail/Apple Mail).
export async function POST(req: Request) {
  return GET(req);
}
