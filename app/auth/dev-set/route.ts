// /auth/dev-set — DEV-ONLY helper that swaps Supabase implicit-flow tokens
// (access_token + refresh_token in URL hash) for a server-side session cookie.
//
// Usage (only intended for local dev when bypassing the standard /auth/callback
// PKCE flow):
//   POST /auth/dev-set
//   body: { access_token, refresh_token, next? }
//
// Behaviour: uses @supabase/ssr server client to call setSession(); cookies are
// attached to the redirect response so the user lands at `next` already signed
// in. Returns 404 in production for safety.

import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Hard guard: refuse outside development.
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = await req.json().catch(() => ({} as any));
  const access_token: string | undefined  = body?.access_token;
  const refresh_token: string | undefined = body?.refresh_token;
  const rawNext: string | undefined       = body?.next;

  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "access_token + refresh_token required" }, { status: 400 });
  }

  const url = new URL(req.url);
  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`))?.[1];
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Validate next path; default to /admin if invalid or absent.
  const safe = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") && !/^[a-z]+:/i.test(rawNext)
    ? rawNext
    : "/admin";

  // Build the redirect response copying the Set-Cookie headers the supabase
  // client wrote into `response` above.
  const redirect = NextResponse.redirect(new URL(safe, url.origin), { status: 303 });
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

// Also support GET via query params (less secure — tokens in URL — but useful
// when posting from the browser address bar isn't an option).
export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }
  const url = new URL(req.url);
  const access_token  = url.searchParams.get("access_token")  || "";
  const refresh_token = url.searchParams.get("refresh_token") || "";
  const next          = url.searchParams.get("next") || "/admin";

  // Reuse POST handler by constructing a synthetic Request
  const synthetic = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: req.headers.get("cookie") || "" },
    body: JSON.stringify({ access_token, refresh_token, next }),
  });
  return POST(synthetic);
}
