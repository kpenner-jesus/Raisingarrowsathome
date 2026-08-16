// ============================================================
//  portal-context.ts — assemble the grant FAMILY's own data into a
//  context string for the read-only portal helper chat.
//
//  Critical isolation rule: this only ever reads the ONE recipient row
//  resolved for the signed-in user (+ that recipient's own receipts /
//  payouts), all scoped by org_id. The portal chat has NO tools, so the
//  model can only answer from what we inject here — it cannot reach any
//  other family's data or any admin action.
// ============================================================

import { supabaseService } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";

export interface PortalChatContext {
  ok:        boolean;
  reason?:   string;
  system?:   string;
}

function money(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`;
}

/**
 * Build the system prompt for the family helper, grounded in this recipient's
 * real numbers. `recipient` is the row from getEffectiveRecipient (already
 * org-scoped); we re-read its receipts/payouts by id, org-scoped.
 */
export async function buildPortalContext(
  recipient: any,
  orgId: string,
  orgName: string,
): Promise<PortalChatContext> {
  if (!recipient) {
    return { ok: false, reason: "no recipient" };
  }
  const svc = supabaseService();

  const [{ data: receipts }, { data: payouts }] = await Promise.all([
    svc.from("receipts")
      .select("id, amount, currency, reimbursable_amount, status, description, purchase_date, created_at")
      .eq("recipient_id", recipient.id).eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    svc.from("payouts")
      .select("amount, status, paid_at, created_at")
      .eq("recipient_id", recipient.id).eq("org_id", orgId),
  ]);

  const rate = Number(recipient.reimbursement_rate);
  const cap  = Number(recipient.approved_amount);
  const committedToDate = (payouts || []).filter((p: any) => p.status !== "cancelled").reduce((s: number, p: any) => s + Number(p.amount), 0);
  const paidToDate      = (payouts || []).filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + Number(p.amount), 0);
  const balance = calcBalance({ receipts: receipts || [], rate, cap, paidToDate, committedToDate });

  const app = recipient.applications || {};
  const pending  = (receipts || []).filter((r: any) => r.status === "pending");
  const approved = (receipts || []).filter((r: any) => r.status === "approved");
  const rejected = (receipts || []).filter((r: any) => r.status === "rejected");

  const recentReceipts = (receipts || []).slice(0, 8).map((r: any) =>
    `- ${r.purchase_date || r.created_at?.split("T")[0] || "?"}: ${r.currency || "CAD"} ${money(r.amount)} "${r.description || "receipt"}" — ${r.status}`
  ).join("\n") || "  (none uploaded yet)";

  const system = [
    `You are a friendly help assistant for grant recipients of "${orgName}", a homeschool grant program.`,
    `You are talking to ${app.parent_names || "a grant family"}. Answer ONLY from the facts below about THEIR own grant. You cannot see other families' data and cannot make any changes — if they ask you to change something or ask about another family, explain that you can only show their own information and point them to contact the program.`,
    `Be warm, brief, and concrete. Today is ${new Date().toISOString().split("T")[0]}.`,
    ``,
    `HOW TO WRITE. You are talking to a parent, not an accountant. Write at about a grade 10 reading level.`,
    `- Short sentences. Aim under 20 words. One idea per sentence.`,
    `- Everyday words. Say "money left" not "remaining balance", "paid back" not "reimbursed", "still being checked" not "pending adjudication".`,
    `- Lead with the number they asked for, then explain it in one line.`,
    `- No filler openers ("Great question", "Certainly"). No bullet-point walls — two or three short sentences beats a table.`,
    `- Simplify the WORDING, never the facts. Dollar amounts, dates and receipt descriptions stay exact.`,
    ``,
    `The headings below are OUR internal labels. Do not repeat them at the family — say what they mean:`,
    `- "Approved grant cap" = the most their grant can ever pay them.`,
    `- "Reimbursement rate" = the share of what they spend that comes back to them.`,
    `- "Reimbursable approved so far" = what their approved receipts have earned back.`,
    `- "Paid out to date" = money already sent to them.`,
    `- "Committed" = money already sent PLUS money lined up to be sent.`,
    `- "Remaining grant cap" = how much of their grant is still left to use.`,
    `- "Eligible for next payout" = what is ready to be sent in the next run.`,
    `- A receipt that is "rejected" was NOT approved — say "wasn't approved" and suggest they ask the program why. Never call a family's receipt rejected without softening it.`,
    ``,
    `THIS FAMILY'S GRANT:`,
    `- Status: ${recipient.status}`,
    `- Approved grant cap: ${money(cap)}`,
    `- Reimbursement rate: ${Math.round(rate * 100)}% of eligible spending`,
    recipient.submission_deadline ? `- Receipt submission deadline: ${recipient.submission_deadline}` : `- No submission deadline on file`,
    ``,
    `BALANCE:`,
    `- Reimbursable approved so far (CAD): ${money(balance.reimbursable)}`,
    `- Paid out to date: ${money(balance.paidToDate)}`,
    `- Committed (scheduled + paid): ${money(balance.committedToDate)}`,
    `- Remaining grant cap: ${money(balance.remainingCap)}`,
    `- Eligible for next payout: ${money(balance.eligibleForNextPayout)}`,
    ``,
    `RECEIPTS: ${(receipts || []).length} total — ${pending.length} pending review, ${approved.length} approved, ${rejected.length} not approved.`,
    `Most recent:`,
    recentReceipts,
    ``,
    `Payouts run on a schedule set by the program (typically mid-month and end-of-month). If they ask "when will I be paid", explain eligible amounts are included in the next scheduled payout run; you don't have an exact date.`,
    `If they need to upload a receipt, tell them to use the "Upload receipt" button in their portal.`,
  ].join("\n");

  return { ok: true, system };
}
