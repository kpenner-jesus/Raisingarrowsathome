// One-off: promote an email to role='admin' in profiles.
// Usage:  node scripts/make-admin.mjs <email>
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2];
if (!email) { console.error("usage: node scripts/make-admin.mjs <email>"); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const { data, error } = await supabase
  .from("profiles")
  .update({ role: "admin" })
  .eq("email", email)
  .select();

console.log(JSON.stringify({ data, error }, null, 2));
process.exit(error ? 1 : 0);
