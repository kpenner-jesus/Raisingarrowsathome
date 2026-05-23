// One-off: import the 7 existing families from Tierza's spreadsheet.
// Usage: node scripts/import-existing-recipients.mjs "C:\path\to\Sheet1.csv"
//
// Creates skeleton applications + recipients (grandfathered=true, no deadline).
// For Sheridan (already received $440.38), creates a legacy batch + payout
// so the balance math is correct going forward.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { randomBytes } from "crypto";

config({ path: ".env.local" });

const csvPath = process.argv[2];
if (!csvPath) { console.error("usage: node scripts/import-existing-recipients.mjs <csv path>"); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── CSV PARSING ──────────────────────────────────────────────
function parseCsvLine(line) {
  // Simple CSV parse with quote support
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (c === "," && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseMoney(s) {
  if (!s) return null;
  const cleaned = s.replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// "691 Berkley Street, Winnipeg, R3R 1K2" → { street, city, postal }
function parseAddress(s) {
  if (!s || !s.trim()) return { street: null, city: null, postal: null };
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { street: null, city: null, postal: null };
  // Canadian postal code regex (with optional space): A1A 1A1 / A1A1A1
  const postalRe = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
  let postal = null, city = null, street = null;
  if (postalRe.test(parts[parts.length - 1])) {
    postal = parts.pop().toUpperCase().replace(/\s+/g, " ");
    // Normalize to "A1A 1A1"
    if (!postal.includes(" ") && postal.length === 6) postal = postal.slice(0, 3) + " " + postal.slice(3);
  }
  if (parts.length >= 2) {
    city = parts.pop();
    street = parts.join(", ");
  } else if (parts.length === 1) {
    street = parts[0];
  }
  return { street, city, postal };
}

// ── LOAD CSV ─────────────────────────────────────────────────
const rows = [];
const rl = createInterface({ input: createReadStream(csvPath, { encoding: "utf8" }) });
let header = null;
for await (const line of rl) {
  if (!line.trim()) continue;
  const cols = parseCsvLine(line);
  if (!header) { header = cols; continue; }
  if (!cols[0]) continue;   // blank name
  rows.push({
    name:      cols[0],
    email:     cols[1],
    address:   cols[2],
    granted:   parseMoney(cols[3]),
    reimSub:   parseMoney(cols[4]),
    paid:      parseMoney(cols[5]),
    balance:   parseMoney(cols[6]),
    notes:     cols[7] || null,
  });
}

console.log(`Parsed ${rows.length} rows from ${csvPath}\n`);

// ── DRY-RUN PREVIEW ──────────────────────────────────────────
for (const r of rows) {
  const a = parseAddress(r.address);
  console.log(`  ${r.name}`);
  console.log(`    email: ${r.email}`);
  console.log(`    address: ${a.street || "—"} | ${a.city || "—"} | ${a.postal || "—"}`);
  console.log(`    cap: $${r.granted}   paid: $${r.paid ?? 0}   balance: $${r.balance ?? r.granted}`);
  console.log();
}

if (process.argv.includes("--dry")) { console.log("[--dry] no DB writes performed."); process.exit(0); }

// ── INSERT ───────────────────────────────────────────────────
const today = new Date().toISOString().split("T")[0];

for (const r of rows) {
  const addr = parseAddress(r.address);
  const firstName = r.name.split(/[\s&]/).filter(Boolean)[0] || "FAMILY";
  const app_ref = `RA-LEGACY-${firstName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12)}-${randomBytes(2).toString("hex").toUpperCase()}`;

  // 1. Insert skeleton application (status=approved, decided today, grandfathered)
  const { data: app, error: appErr } = await supabase
    .from("applications")
    .insert({
      app_ref,
      parent_names:      r.name,
      city:              addr.city || "—",
      contact_email:     r.email,
      contact_phone:     "—",
      income_range:      "—",
      current_schooling: "—",
      children:          [],
      answers:           { _legacy: "Imported from Tierza's pre-portal spreadsheet 2026-05-23" },
      video_link:        null,
      status:            "approved",
      admin_notes:       "Legacy import from spreadsheet — predates online application funnel.",
      decided_at:        new Date().toISOString(),
    })
    .select("id")
    .single();
  if (appErr) { console.error(`FAIL ${r.name}:`, appErr.message); continue; }

  // 2. Insert recipient (grandfathered, no deadline)
  const { data: recipient, error: recErr } = await supabase
    .from("recipients")
    .insert({
      application_id:      app.id,
      profile_id:          null,                // not yet linked to an auth user
      approved_amount:     r.granted,
      reimbursement_rate:  0.75,
      status:              "active",
      address_street:      addr.street,
      address_city:        addr.city,
      address_postal:      addr.postal,
      submission_deadline: null,                // grandfathered
      grandfathered:       true,
    })
    .select("id")
    .single();
  if (recErr) { console.error(`FAIL ${r.name} (recipient):`, recErr.message); continue; }

  console.log(`✓ ${r.name} → recipient ${recipient.id}`);

  // 3. For Sheridan-style families with existing paid amount, create legacy batch + payout
  if ((r.paid ?? 0) > 0) {
    const { data: batch, error: batchErr } = await supabase
      .from("payout_batches")
      .insert({
        scheduled_date: today,
        status:         "paid",
        total:          r.paid,
        ceo_reference:  "PRE-PORTAL IMPORT",
        paid_at:        new Date().toISOString(),
        exported_at:    new Date().toISOString(),
        bucket:         "legacy",
      })
      .select("id")
      .single();
    if (batchErr) { console.error(`  └ FAIL legacy batch:`, batchErr.message); continue; }

    const { error: payErr } = await supabase
      .from("payouts")
      .insert({
        batch_id:                 batch.id,
        recipient_id:             recipient.id,
        amount:                   r.paid,
        receipts_included:        [],
        status:                   "paid",
        paid_at:                  new Date().toISOString(),
        payment_method:           "e-transfer (pre-portal)",
        payment_reference:        "imported from spreadsheet",
      });
    if (payErr) console.error(`  └ FAIL legacy payout:`, payErr.message);
    else console.log(`  └ legacy payout $${r.paid} recorded`);
  }
}

console.log("\nDone.");
process.exit(0);
