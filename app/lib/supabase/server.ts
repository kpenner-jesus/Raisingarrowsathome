// ============================================================
//  Supabase clients (server-side)
//
//  - supabaseServer(): user-scoped, respects RLS, uses cookies
//  - supabaseService(): service-role, BYPASSES RLS — server only
// ============================================================

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function supabaseServer() {
  // Async since Next 15: cookies() returns a Promise.
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server components cannot set cookies; the middleware refreshes
          // the session for them, so a throw here is expected and harmless.
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch { /* server component */ }
        },
      },
    }
  );
}

export function supabaseService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
