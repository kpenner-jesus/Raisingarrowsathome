// ============================================================
//  MCP auth — Bearer token → admin profile resolution
//
//  Token format: ramcp_<48 hex chars>
//  Stored as sha256(token) in api_tokens.token_hash.
//  Token plaintext shown ONCE at mint, never logged.
// ============================================================

import { createHash } from "crypto";
import { supabaseService } from "@/app/lib/supabase/server";

export interface AuthedToken {
  token_id:   string;
  profile_id: string;
  email:      string;
  /** Tenant the token belongs to — populated from api_tokens.org_id. */
  org_id:     string;
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Resolves a Bearer header value to an admin profile.
 * Returns null on any failure (invalid token, revoked, not admin, etc.).
 * Updates last_used_at on success.
 */
export async function authBearer(authHeader: string | null): Promise<AuthedToken | null> {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(ramcp_[a-f0-9]{48})$/i);
  if (!match) return null;
  const plaintext = match[1];
  const hash = hashToken(plaintext);

  const supabase = supabaseService();
  const { data: token } = await supabase
    .from("api_tokens")
    .select("id, profile_id, org_id, revoked_at, expires_at, profiles!inner(email, role)")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!token) return null;
  if (token.revoked_at) return null;
  if (token.expires_at && new Date(token.expires_at) < new Date()) return null;
  if (!token.org_id) return null;          // token must be tenant-scoped

  const profile = (token as any).profiles;
  if (!profile) return null;
  if (profile.role !== "admin" && profile.role !== "super_admin") return null;

  // Fire-and-forget last_used update
  supabase.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id).then(() => {});

  return {
    token_id:   token.id,
    profile_id: token.profile_id,
    email:      profile.email,
    org_id:     token.org_id,
  };
}
