// One-off: mint a new MCP Bearer token for an admin user.
// Usage:
//   node scripts/mint-mcp-token.mjs <admin_email> <label>
//
// Prints the plaintext token ONCE. Save it. We only store sha256(token).
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createHash, randomBytes } from "crypto";

config({ path: ".env.local" });

const [, , email, label] = process.argv;
if (!email || !label) {
  console.error("usage: node scripts/mint-mcp-token.mjs <admin_email> <label>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Look up admin profile
const { data: profile, error: pErr } = await supabase
  .from("profiles")
  .select("id, email, role")
  .eq("email", email)
  .single();
if (pErr || !profile) { console.error("profile not found:", pErr?.message); process.exit(1); }
if (profile.role !== "admin") { console.error("not an admin:", email); process.exit(1); }

// Generate token: ramcp_<48 hex chars>
const plaintext = "ramcp_" + randomBytes(24).toString("hex");
const tokenHash = createHash("sha256").update(plaintext).digest("hex");
const prefix    = plaintext.slice(0, 14);   // ramcp_xxxxxxxx

const { data, error } = await supabase
  .from("api_tokens")
  .insert({
    profile_id: profile.id,
    label,
    prefix,
    token_hash: tokenHash,
  })
  .select("id, created_at")
  .single();

if (error) { console.error("mint failed:", error.message); process.exit(1); }

console.log("");
console.log("════════════════════════════════════════════════════════════════");
console.log(" New MCP token (shown ONCE — save it now)");
console.log("════════════════════════════════════════════════════════════════");
console.log("");
console.log("  " + plaintext);
console.log("");
console.log("  Label:     " + label);
console.log("  Admin:     " + email);
console.log("  Token id:  " + data.id);
console.log("  Created:   " + data.created_at);
console.log("");
console.log(" Add to Claude Code:");
console.log('   claude mcp add raising-arrows --scope user --transport http \\');
console.log(`     --header "Authorization: Bearer ${plaintext}" \\`);
console.log("     http://localhost:3000/api/mcp");
console.log("");
console.log(" Or for prod (after Vercel deploy):");
console.log("   ...same command but URL = https://YOUR-DOMAIN/api/mcp");
console.log("════════════════════════════════════════════════════════════════");
