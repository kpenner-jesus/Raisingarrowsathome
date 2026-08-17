import { describe, it, expect } from "vitest";
import {
  parseLimits,
  normalizeIp,
  pickClientIp,
  bucketKey,
  normalizeEmail,
  buildBuckets,
  decideThrottle,
  answerKeyCountOk,
  isHoneypotTripped,
  HONEYPOT_FIELD,
  type ThrottleRow,
} from "./submit-throttle-logic";

const SECRET = "test-secret";

describe("parseLimits", () => {
  it("uses defaults when nothing is set", () => {
    expect(parseLimits({})).toEqual({ ipHour: 8, ipDay: 20, emailDay: 3, orgDay: 40 });
  });
  it("honours overrides", () => {
    expect(parseLimits({ APPLY_RL_EMAIL_DAY: "9" }).emailDay).toBe(9);
  });
  it("floors fractional values", () => {
    expect(parseLimits({ APPLY_RL_IP_HOUR: "4.9" }).ipHour).toBe(4);
  });
  it("falls back on junk, zero and negatives", () => {
    expect(parseLimits({ APPLY_RL_IP_HOUR: "nope" }).ipHour).toBe(8);
    expect(parseLimits({ APPLY_RL_IP_HOUR: "0" }).ipHour).toBe(8);
    expect(parseLimits({ APPLY_RL_IP_HOUR: "-3" }).ipHour).toBe(8);
  });
});

describe("normalizeIp", () => {
  it("passes through a public IPv4", () => {
    expect(normalizeIp("203.0.114.5")).toBe("203.0.114.5");
  });

  it("rejects loopback, private and link-local v4", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1",
                      "172.31.255.255", "169.254.1.1", "0.0.0.0", "100.64.0.1"]) {
      expect(normalizeIp(ip), ip).toBeNull();
    }
  });

  it("keeps 172.15 and 172.32 — they are NOT in 172.16/12", () => {
    expect(normalizeIp("172.15.0.1")).toBe("172.15.0.1");
    expect(normalizeIp("172.32.0.1")).toBe("172.32.0.1");
  });

  it("strips a port from IPv4", () => {
    expect(normalizeIp("203.0.114.5:5678")).toBe("203.0.114.5");
  });

  it("collapses IPv4-mapped IPv6 to the plain v4 form", () => {
    // Or one host would count as two separate identities.
    expect(normalizeIp("::ffff:203.0.114.5")).toBe("203.0.114.5");
    expect(normalizeIp("::ffff:127.0.0.1")).toBeNull();
  });

  it("truncates IPv6 to the /64 prefix", () => {
    expect(normalizeIp("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
  });

  it("gives every address in one /64 the SAME identity", () => {
    // This is the whole point: a household rotates the low 64 bits freely.
    const a = normalizeIp("2001:db8:aaaa:1:1111:2222:3333:4444");
    const b = normalizeIp("2001:db8:aaaa:1:9999:8888:7777:6666");
    expect(a).toBe(b);
    expect(normalizeIp("2001:db8:aaaa:2:1111:2222:3333:4444")).not.toBe(a);
  });

  it("expands :: compression correctly", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("2606:4700::6812:2")).toBe("2606:4700:0:0::/64");
  });

  it("strips brackets and port from IPv6", () => {
    expect(normalizeIp("[2001:db8:1:2::1]:443")).toBe("2001:db8:1:2::/64");
  });

  it("rejects ::, ::1, unique-local and link-local v6", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1"]) {
      expect(normalizeIp(ip), ip).toBeNull();
    }
  });

  it("rejects junk and empty input", () => {
    for (const ip of ["", "   ", "not-an-ip", "1.2.3", "1.2.3.4.5", "999.1.1.1",
                      "2001:db8:::1", "[2001:db8::1", "gggg::1", null, undefined]) {
      expect(normalizeIp(ip as any), String(ip)).toBeNull();
    }
  });
});

describe("pickClientIp", () => {
  it("returns null when the proxy is not trusted", () => {
    // Off-Vercel, x-forwarded-for is caller-controlled — enforcing on it
    // would be theatre, so we skip the IP buckets honestly.
    expect(pickClientIp({ "x-forwarded-for": "203.0.114.5" }, { trustProxy: false })).toBeNull();
  });

  it("prefers the Vercel-injected header", () => {
    const ip = pickClientIp({
      "x-vercel-forwarded-for": "203.0.114.5",
      "x-real-ip": "198.51.101.9",
      "x-forwarded-for": "1.1.1.1",
    }, { trustProxy: true });
    expect(ip).toBe("203.0.114.5");
  });

  it("takes the LEFTMOST hop of x-forwarded-for", () => {
    const ip = pickClientIp(
      { "x-forwarded-for": "203.0.114.5, 70.1.1.1, 10.0.0.1" },
      { trustProxy: true },
    );
    expect(ip).toBe("203.0.114.5");
  });

  it("falls through a private first hop to the next usable header", () => {
    const ip = pickClientIp(
      { "x-vercel-forwarded-for": "10.0.0.1", "x-real-ip": "203.0.114.5" },
      { trustProxy: true },
    );
    expect(ip).toBe("203.0.114.5");
  });

  it("returns null when no header carries a usable address", () => {
    expect(pickClientIp({}, { trustProxy: true })).toBeNull();
    expect(pickClientIp({ "x-forwarded-for": "127.0.0.1" }, { trustProxy: true })).toBeNull();
  });
});

describe("bucketKey", () => {
  it("is deterministic", () => {
    expect(bucketKey(SECRET, "ip", "1.2.3.4")).toBe(bucketKey(SECRET, "ip", "1.2.3.4"));
  });
  it("never returns the raw value", () => {
    const k = bucketKey(SECRET, "ip", "203.0.114.5");
    expect(k).not.toContain("203.0.114.5");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
  it("separates scopes, so one value cannot spend another bucket", () => {
    expect(bucketKey(SECRET, "ip", "x")).not.toBe(bucketKey(SECRET, "email", "x"));
  });
  it("changes with the secret", () => {
    expect(bucketKey("a", "ip", "x")).not.toBe(bucketKey("b", "ip", "x"));
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims so casing can't mint a fresh budget", () => {
    expect(normalizeEmail("  Mary@Example.COM ")).toBe("mary@example.com");
  });
  it("rejects anything without an @", () => {
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
});

describe("buildBuckets", () => {
  const base = { secret: SECRET, orgId: "org-1", limits: parseLimits({}) };

  it("orders buckets by precedence", () => {
    const b = buildBuckets({ ...base, ip: "203.0.114.5", email: "a@b.com" });
    expect(b.map((x) => x.scope)).toEqual(["ip_hour", "ip_day", "email_day", "org_day"]);
  });

  it("omits the IP buckets entirely when there is no usable address", () => {
    const b = buildBuckets({ ...base, ip: null, email: "a@b.com" });
    expect(b.map((x) => x.scope)).toEqual(["email_day", "org_day"]);
  });

  it("omits the email bucket when there is no email", () => {
    const b = buildBuckets({ ...base, ip: "203.0.114.5", email: null });
    expect(b.map((x) => x.scope)).toEqual(["ip_hour", "ip_day", "org_day"]);
  });

  it("ALWAYS includes the org breaker — it is the spend backstop", () => {
    const b = buildBuckets({ ...base, ip: null, email: null });
    expect(b.map((x) => x.scope)).toEqual(["org_day"]);
  });

  it("gives the hour and day IP buckets the same key but different windows", () => {
    const b = buildBuckets({ ...base, ip: "203.0.114.5", email: null });
    expect(b[0].key).toBe(b[1].key);
    expect(b[0].window_s).toBe(3600);
    expect(b[1].window_s).toBe(86400);
  });
});

describe("decideThrottle", () => {
  const row = (o: Partial<ThrottleRow>): ThrottleRow => ({
    out_scope: "ip_hour", hits: 1, lim: 8, allowed: true,
    retry_after_s: null, evaluated: true, ...o,
  });

  it("allows when nothing is over", () => {
    expect(decideThrottle([row({}), row({ out_scope: "org_day" })])).toEqual({ action: "allow" });
  });

  it("FAILS OPEN on empty or missing rows", () => {
    // An RPC error or a not-yet-applied migration looks exactly like this.
    // Turning real families away is worse than letting a burst through.
    expect(decideThrottle([])).toEqual({ action: "allow" });
    expect(decideThrottle(null)).toEqual({ action: "allow" });
    expect(decideThrottle(undefined)).toEqual({ action: "allow" });
  });

  it("rejects on an IP bucket, carrying retry-after", () => {
    const v = decideThrottle([row({ out_scope: "ip_hour", allowed: false, retry_after_s: 1800 })]);
    expect(v.action).toBe("reject");
    if (v.action !== "reject") throw new Error("unreachable");
    expect(v.scope).toBe("ip_hour");
    expect(v.retryAfterS).toBe(1800);
    expect(v.message).toMatch(/your answers are still here/i);
  });

  it("uses kinder copy for the email bucket", () => {
    const v = decideThrottle([row({ out_scope: "email_day", allowed: false, retry_after_s: 100 })]);
    if (v.action !== "reject") throw new Error("expected reject");
    expect(v.message).toMatch(/already have an application/i);
    expect(v.message).not.toMatch(/spam|abuse|blocked/i);
  });

  it("does NOT reject on the org breaker — it saves the row and skips the email", () => {
    const v = decideThrottle([
      row({ out_scope: "ip_hour" }),
      row({ out_scope: "org_day", allowed: false, retry_after_s: 500 }),
    ]);
    expect(v).toEqual({ action: "accept_no_email", scope: "org_day" });
  });

  it("ignores rows the RPC short-circuited without evaluating", () => {
    // evaluated=false rows carry allowed=false but were never counted.
    const v = decideThrottle([
      row({ out_scope: "ip_hour", allowed: true }),
      row({ out_scope: "email_day", allowed: false, evaluated: false }),
    ]);
    expect(v).toEqual({ action: "allow" });
  });

  it("reports the FIRST denial when several are over", () => {
    const v = decideThrottle([
      row({ out_scope: "ip_hour", allowed: false, retry_after_s: 60 }),
      row({ out_scope: "email_day", allowed: false, retry_after_s: 999 }),
    ]);
    if (v.action !== "reject") throw new Error("expected reject");
    expect(v.scope).toBe("ip_hour");
  });

  it("substitutes a sane retry-after when the RPC returns none", () => {
    const v = decideThrottle([row({ allowed: false, retry_after_s: null })]);
    if (v.action !== "reject") throw new Error("expected reject");
    expect(v.retryAfterS).toBe(60);
  });
});

describe("answerKeyCountOk", () => {
  const withKeys = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, "v"]));

  it("accepts the real funnel's nine answers", () => {
    expect(answerKeyCountOk(withKeys(9))).toBe(true);
  });
  it("accepts exactly the cap", () => {
    expect(answerKeyCountOk(withKeys(40))).toBe(true);
  });
  it("rejects one over the cap", () => {
    expect(answerKeyCountOk(withKeys(41))).toBe(false);
  });
  it("rejects the payload bomb", () => {
    expect(answerKeyCountOk(withKeys(5000))).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(answerKeyCountOk(null)).toBe(false);
    expect(answerKeyCountOk("nope")).toBe(false);
  });
  it("honours a custom cap", () => {
    expect(answerKeyCountOk(withKeys(5), 4)).toBe(false);
  });
});

describe("isHoneypotTripped", () => {
  it("is not tripped by a real submission", () => {
    expect(isHoneypotTripped({ parent_names: "Mary" })).toBe(false);
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: "" })).toBe(false);
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: "   " })).toBe(false);
    expect(isHoneypotTripped(null)).toBe(false);
  });
  it("is tripped when the hidden field carries anything", () => {
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: "http://spam" })).toBe(true);
  });
});
