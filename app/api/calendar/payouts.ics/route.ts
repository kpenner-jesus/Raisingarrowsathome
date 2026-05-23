// GET /api/calendar/payouts.ics
// iCalendar feed of payout windows. Subscribe in Google/Apple Calendar
// using the URL. Public (no PII inside) so admins can subscribe
// without an auth token.
//
// Includes 24 fixed events per year (12 months × 2 windows) for the
// current + next year. Each event is a 30-min block at noon UTC.
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function dt(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
function lastDayOfMonth(year: number, monthZero: number): number {
  return new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
}

function buildIcs(): string {
  const now = new Date();
  const yearStart = now.getUTCFullYear();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Raising Arrows//Payout Calendar//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Raising Arrows payouts",
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
        const uid = `ra-${y}${pad(m+1)}${pad(day)}-${e.name.replace(/\s+/g,"_")}@raisingarrowsathome.com`;
        lines.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${dt(now)}`,
          `DTSTART:${dt(start)}`,
          `DTEND:${dt(end)}`,
          `SUMMARY:Raising Arrows — ${e.name}`,
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
  return new NextResponse(buildIcs(), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
      "Content-Disposition": `inline; filename="raising-arrows-payouts.ics"`,
    },
  });
}
