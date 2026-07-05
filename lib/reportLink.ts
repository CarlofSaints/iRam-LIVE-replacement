import crypto from "crypto";

// Signed, self-expiring links for the public /r store-report page.
//
// WHY: /r used to take plain query params (?site=M27&clientId=…&year=…). Anyone
// holding one link could just change the site code and pull up ANY store's
// report — trivial enumeration (e.g. a competitor's rep). We are NOT adding auth
// (any rep may view any report); we only need the address to be UNGUESSABLE and
// UNTWEAKABLE, and to expire.
//
// HOW: the site/client/period is packed into a base64url payload and signed with
// an HMAC-SHA256 tag using a server-only secret. Change any field and the tag no
// longer matches, so a link can't be forged or edited without the secret. An
// `exp` timestamp is baked in at signing time, so each link self-expires with no
// stored state — nothing to store, nothing to clean up, regardless of how many
// links are minted as DISPOs load. Verification recomputes the tag and checks exp.

export interface ReportLinkPayload {
  site: string;
  clientId?: string;
  year?: number;
  month?: number;
  week?: number;
}

// Secret used to sign links. Prefer a dedicated REPORT_LINK_SECRET; fall back to
// the already-configured CRON_SECRET (also unguessable) so this works with zero
// extra setup, then a constant last-resort so nothing crashes if neither is set.
function secret(): string {
  return (
    process.env.REPORT_LINK_SECRET ||
    process.env.CRON_SECRET ||
    "iram-live-report-link-default-secret"
  );
}

// Link lifetime in days. Adjustable in Vercel without a redeploy; default 21 (3 weeks).
function ttlDays(): number {
  const n = parseInt(process.env.REPORT_LINK_TTL_DAYS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 21;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(body: string): string {
  return b64urlEncode(crypto.createHmac("sha256", secret()).update(body).digest());
}

// Build the opaque token that replaces the plain query params. `exp` is the unix
// epoch (seconds) at which the link stops working.
export function signReportLink(payload: ReportLinkPayload, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + ttlDays() * 86400;
  const data: Record<string, unknown> = { s: payload.site, e: exp };
  if (payload.clientId) data.c = payload.clientId;
  if (payload.year != null) data.y = payload.year;
  if (payload.month != null) data.m = payload.month;
  if (payload.week != null) data.w = payload.week;
  const body = b64urlEncode(Buffer.from(JSON.stringify(data), "utf8"));
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { ok: true; payload: Required<Pick<ReportLinkPayload, "site">> & ReportLinkPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

// Verify a token: constant-time tag check, then expiry check. Returns the decoded
// payload on success. Any tampering (edited site code, flipped period) fails the
// signature check; an old link fails the expiry check.
export function verifyReportLink(token: string, now: Date = new Date()): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const tag = token.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(tag);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const exp = typeof data.e === "number" ? data.e : 0;
  if (!exp || Math.floor(now.getTime() / 1000) > exp) {
    return { ok: false, reason: "expired" };
  }
  const site = typeof data.s === "string" ? data.s : "";
  if (!site) return { ok: false, reason: "malformed" };

  return {
    ok: true,
    payload: {
      site,
      clientId: typeof data.c === "string" ? data.c : undefined,
      year: typeof data.y === "number" ? data.y : undefined,
      month: typeof data.m === "number" ? data.m : undefined,
      week: typeof data.w === "number" ? data.w : undefined,
    },
  };
}

// Whether to still honour legacy plain-param links (?site=…) that reps already
// have in their inboxes. Default ON (a grace window); set ALLOW_LEGACY_REPORT_LINKS
// to "0"/"false" once the old links have aged out to fully close enumeration.
export function legacyLinksAllowed(): boolean {
  const v = (process.env.ALLOW_LEGACY_REPORT_LINKS || "").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}
