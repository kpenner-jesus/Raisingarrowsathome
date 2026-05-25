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
        video_link:        clip(video_link, 500) || null,
        waitlisted,
      })
      .select("id, app_ref")
      .single();
    if (error) return new NextResponse(error.message, { status: 500 });

    // Fire-and-forget: confirmation email to family with self-withdraw link.
    const origin = new URL(req.url).origin;
    try {
      const withdrawToken = signToken(`withdraw:${data.id}`, 60 * 60 * 24 * 30);  // 30 days
      notifyApplicationReceived({
        to:           clip(contact_email, 200),
        parent_names: clip(parent_names, 100),
        app_ref:      data.app_ref,
        withdraw_url: `${origin}${orgPath(orgCtx, `/apply/withdraw?token=${encodeURIComponent(withdrawToken)}`)}`,
        orgId:        orgCtx.id,
      }).catch(() => { /* logged inside */ });
    } catch { /* signing failed (missing secret) — skip silently */ }

    // Fire-and-forget admin alert (Slack + email). Never blocks/fails the user.
    sendAdminAlert({
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
    }).catch(() => { /* logged inside */ });

    return NextResponse.json({ id: data.id, app_ref: data.app_ref });
  } catch (e: any) {
    return new NextResponse(e?.message || "error", { status: 500 });
  }
}
