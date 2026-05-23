// One-off: smoke-test Resend delivery.
// Usage:  node scripts/test-resend.mjs <to_email>
import { Resend } from "resend";
import { config } from "dotenv";
config({ path: ".env.local" });

const to = process.argv[2];
if (!to) { console.error("usage: node scripts/test-resend.mjs <to_email>"); process.exit(1); }

const resend = new Resend(process.env.RESEND_API_KEY);
const from   = process.env.RESEND_FROM;

console.log("From:", from);
console.log("To:  ", to);

const { data, error } = await resend.emails.send({
  from,
  to,
  subject: "Raising Arrows — Resend domain verification test",
  html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.6;max-width:520px;margin:24px auto;padding:0 16px;">
    <h1 style="font-family:Georgia,serif;font-style:italic;color:#e8793a;">Raising Arrows</h1>
    <p>Hi Kevin,</p>
    <p>If you're reading this, Resend domain verification worked. The grant portal is now wired to send transactional email from <code>${from}</code>.</p>
    <p>Next time you approve an application or mark a payout paid, the recipient gets a real email.</p>
    <p>The Raising Arrows team</p>
  </body></html>`,
});

if (error) { console.error("ERROR:", JSON.stringify(error, null, 2)); process.exit(1); }
console.log("Sent. Resend id:", data.id);
