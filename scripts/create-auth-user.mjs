// Pre-create an auth user (skips magic-link invite + its rate limit).
// Usage:  node scripts/create-auth-user.mjs <email>
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2];
if (!email) { console.error("usage: node scripts/create-auth-user.mjs <email>"); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data, error } = await supabase.auth.admin.createUser({
  email,
  email_confirm: true,
});
if (error) { console.error(JSON.stringify(error, null, 2)); process.exit(1); }
console.log("Auth user created:", data.user.id, data.user.email);
