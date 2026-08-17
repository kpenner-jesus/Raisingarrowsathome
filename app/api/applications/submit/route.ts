// ============================================================
//  POST /api/applications/submit
//
//  Called by the public apply funnel after the review-page email
//  is sent. Persists the application so admin can review.
//
//  Security:
//   - app_ref is REGENERATED server-side (client-supplied value
//     is ignored) to prevent collisions + spoofing.
//   - String fields are length-capped to defend against payload bombing.
//   - Endpoint is unauthenticated by design (public funnel); spam
//     mitigation should be added at the edge if abuse appears.
// ============================================================

import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { sendAdminAlert } from "@/app/lib/alerts";
import { notifyApplicationReceived } from "@/app/lib/notify";
import { signToken } from "@/app/lib/hmac";
import { getSettings } from "@/app/lib/settings";
import { getOrgContext, orgPath } from "@/app/lib/org-context";
import { checkSubmitThrottle, alertMailQuotaReached } from "@/app/lib/submit-throttle";
import { answerKeyCountOk, isHoneypotTripped, MAX_ANSWER_KEYS } from "@/app/lib/submit-throttle-logic";
import { randomBytes } from "crypto";

const MAX_TEXT = 4000;
const MAX_KIDS = 12;

function clip(s: any, max: number): string {
  if (typeof s !== "string") return "";
  return s.slice(0, max);
}

function generateAppRef(firstName: string): string {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const slug = (firstName || "FAMILY").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12) || "FAMILY";
  const rand = randomBytes(2).toString("hex").toUpperCase();   // 4 chars
  return `RA-${date}-${slug}-${rand}`;
}

/** Accept only a plain http(s) URL. Anything else becomes null. */
function safeHttpUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  // Control characters are stripped by URL parsing, so reject them up front
  // rather than reasoning about a string the browser will not see.
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c === 127) return null;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // Resolve the tenant for this request. Path-routed (/o/<slug>/api/...)
    // resolves via middleware-set header; legacy hosts resolve from Host.
    const orgCtx = await getOrgContext();
    if (!orgCtx) {
      return new NextResponse("no tenant resolved for this host", { status: 400 });
    }

    // Intake gate — closed = hard reject. waitlist = accept + flag.
    // Tenant-scoped: each org owns its own intake status.
    const settings = await getSettings(orgCtx.id);
    if (settings.intakeStatus === "closed") {
      return new NextResponse("applications are currently closed", { status: 403 });
    }
    const waitlisted = settings.intakeStatus === "waitlist";

    const body = await req.json().catch(() => ({} as any));
    const {
      parent_names, city, contact_email, contact_phone,
      income_range, current_schooling, children, answers, video_link,
    } = body;

    if (!parent_names || !contact_email) {
      return new NextResponse("missing required fields", { status: 400 });
    }

    // Basic shape validation
    if (!Array.isArray(children) || children.length === 0 || children.length > MAX_KIDS) {
      return new NextResponse("invalid children", { status: 400 });
    }
    if (typeof answers !== "object" || answers === null) {
      return new NextResponse("invalid answers", { status: 400 });
    }

    // ── Zero-IO defences ────────────────────────────────────
    // These cost nothing and keep working when Postgres is unreachable —
    // which is exactly when the rate limiter below does not. That is what
    // makes the limiter's fail-open behaviour defensible rather than lazy.

    // Checked BEFORE the Object.entries loop that clips each value: counting
    // after would mean allocating the very thing we are trying to bound. Each
    // key is already capped at 50 chars and each value at MAX_TEXT, but the
    // NUMBER of keys was unbounded, so one request could persist megabytes.
    if (!answerKeyCountOk(answers, MAX_ANSWER_KEYS)) {
      console.error("[submit] answers key count over cap", {
        org: orgCtx.slug, keys: Object.keys(answers as object).length, cap: MAX_ANSWER_KEYS,
      });
      return new NextResponse("too many answers", { status: 400 });
    }

    // A hidden field no human sees. The operator authors this funnel, so a
    // real family cannot trip it; a bot that fills every input can.
    if (isHoneypotTripped(body)) {
      console.warn("[submit] honeypot tripped — dropping submission", { org: orgCtx.slug });
      // Answer exactly like a success so a bot learns nothing from the
      // difference. Nothing is saved and no email is sent.
      return NextResponse.json({ id: null, app_ref: null });
    }

    // ── Rate limit ──────────────────────────────────────────
    // Before the insert and before either email: the emails are the expensive,
    // reputation-damaging part.
    const throttle = await checkSubmitThrottle({
      orgId:   orgCtx.id,
      orgName: orgCtx.name,
      headers: req.headers,
      email:   typeof contact_email === "string" ? contact_email : null,
    });
    if (throttle.action === "reject") {
      return new NextResponse(throttle.message, {
        status: 429,
        headers: { "Retry-After": String(throttle.retryAfterS) },
      });
    }
    // The org-wide breaker never rejects — it saves the application and holds
    // the mail back. A lost application is unrecoverable; a missing
    // confirmation email is not.
    const emailsSuppressed = throttle.action === "accept_no_email";

    const firstName = clip(parent_names, 50).split(/\s+/)[0] || "FAMILY";
    const app_ref = generateAppRef(firstName);

    // Length-clip every freeform string + cap answers
    const cleanAnswers: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) {
      cleanAnswers[clip(k, 50)] = clip(v, MAX_TEXT);
    }
    const cleanChildren = children.slice(0, MAX_KIDS).map((c: any) => ({
      age:   Number(c?.age) || 0,
      grade: clip(c?.grade, 30),
    }));

    const supabase = supabaseService();
    const { data, error } = await supabase
      .from("applications")
      .insert({
        org_id:            orgCtx.id,
        app_ref,
        parent_names:      clip(parent_names, 200),
        city:              clip(city, 100),
        contact_email:     clip(contact_email, 200),
        contact_phone:     clip(contact_phone, 50),
        income_range:      clip(income_range, 100),
        current_schooling: clip(current_schooling, 100),
        children:          cleanChildren,
        answers:           cleanAnswers,
        // Scheme-checked, not just length-clipped. This value is rendered as
        // an <a href> in the admin console, and React 18 still emits a
        // javascript: URL (it only warns) - so an applicant could hand an
        // admin a link that runs script in their signed-in session.
        video_link:        safeHttpUrl(clip(video_link, 500)),
        waitlisted,
      })
      .select("id, app_ref")
      .single();
    if (error) return new NextResponse(error.message, { status: 500 });

    // Await notifications so a Vercel serverless teardown can't kill the
    // Resend/Slack HTTPS call mid-flight (which silently drops the family's
    // confirmation email + the admin Slack alert). Adds ~300ms — fine for a
    // once-per-applicant action. The ENTIRE block is wrapped so NOTHING after
    // the successful insert (a sync throw in orgPath/signToken, a notify
    // rejection) can turn an already-saved application into a 500 → the family
    // never re-submits a duplicate.
    if (emailsSuppressed) {
      await alertMailQuotaReached(orgCtx.name, data.app_ref);
      return NextResponse.json({ id: data.id, app_ref: data.app_ref });
    }

    try {
      const origin = process.env.NEXT_PUBLIC_PLATFORM_URL || new URL(req.url).origin;
      const withdrawToken = signToken(`withdraw:${data.id}`, 60 * 60 * 24 * 30);  // 30 days
      await notifyApplicationReceived({
        to:           clip(contact_email, 200),
        parent_names: clip(parent_names, 100),
        app_ref:      data.app_ref,
        withdraw_url: `${origin}${orgPath(orgCtx, `/apply/withdraw?token=${encodeURIComponent(withdrawToken)}`)}`,
        orgId:        orgCtx.id,
      });
      await sendAdminAlert({
        title: `New grant application — ${orgCtx.name}`,
        summary: `${clip(parent_names, 60)} just submitted an application.`,
        url: `${origin}${orgPath(orgCtx, `/admin/applications/${data.id}`)}`,
        fields: [
          { label: "Org",      value: orgCtx.name },
          { label: "Family",   value: clip(parent_names, 100) },
          { label: "City",     value: clip(city, 100) || "—" },
          { label: "Email",    value: clip(contact_email, 200) },
          { label: "Children", value: String(cleanChildren.length) },
          { label: "App ref",  value: data.app_ref },
        ],
      });
    } catch (e: any) {
      console.warn("[submit] post-insert notification failed (application still saved):", e?.message || e);
    }

    return NextResponse.json({ id: data.id, app_ref: data.app_ref });
  } catch (e: any) {
    return new NextResponse(e?.message || "error", { status: 500 });
  }
}
