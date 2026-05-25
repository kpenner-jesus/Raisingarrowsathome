// GET /api/calendar/payouts.ics
// iCalendar feed of payout windows. Subscribe in Google/Apple Calendar
// using the URL. Public (no PII inside) so admins can subscribe
// without an auth token.
//
// Includes 24 fixed events per year (12 months × 2 windows) for the
// current + next year. Each event is a 30-min block at noon UTC.
//
// Tenant-aware: the calendar name + UID host are derived from the
// resolved tenant so two charities subscribing to the same path each
// see their own org's calendar in their client (no collisions on UID).
import { NextResponse } from "next/server";
import { getOrgContext } from "@/app/lib/org-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function dt(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
function lastDayOfMonth(year: number, monthZero: number): number {
  return new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
}

function buildIcs(orgName: string, orgSlug: string): string {
  const now = new Date();
  const yearStart = now.getUTCFullYear();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${orgName}//Payout Calendar//EN`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${orgName} payouts`,
    "X-WR-TIMEZONE:UTC",
  ];

  type Spec = { name: string; day: number | "last" };
  const events: Spec[] = [
    { name: "Bi-monthly summary (mid)",   day: 1   },
    { name: "Payout batch (mid-month)",    day: 15  },
    { name: "Bi-monthly summary (end)",    day: 17  },
    { name: "Payout batch (end-of-month)", day: "last" },
  ];

  for (let y = yearStart; y <= yearStart + 1; y++) {
    for (let m = 0; m < 12; m++) {
      for (const e of events) {
        const day = e.day === "last" ? lastDayOfMonth(y, m) : e.day;
        const start = new Date(Date.UTC(y, m, day, 12, 0, 0));
        const end   = new Date(Date.UTC(y, m, day, 12, 30, 0));
        // Per-tenant UID so subscribing to multiple orgs doesn't collide
        // in the calendar client's de-dupe pass.
        const uid = `${orgSlug}-${y}${pad(m+1)}${pad(day)}-${e.name.replace(/\s+/g,"_")}@${orgSlug}.raisingarrowsathome.com`;
        lines.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${dt(now)}`,
          `DTSTART:${dt(start)}`,
          `DTEND:${dt(end)}`,
          `SUMMARY:${orgName} — ${e.name}`,
          "DESCRIPTION:Automated cron job runs at noon UTC.",
          "END:VEVENT"
        );
      }
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export async function GET() {
  const orgCtx = await getOrgContext();
  // No tenant resolved → render an empty calendar rather than 500.
  // The subscribe URL is meant to be hit from a tenant-resolving host.
  const orgName = orgCtx?.name ?? "Raising Arrows";
  const orgSlug = orgCtx?.slug ?? "raising-arrows";

  return new NextResponse(buildIcs(orgName, orgSlug), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Per-tenant feed — keep cache private so a CDN doesn't cross-pollinate.
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": `inline; filename="${orgSlug}-payouts.ics"`,
    },
  });
}
