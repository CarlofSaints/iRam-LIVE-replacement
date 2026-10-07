// The session cookie must be signed: a hand-written cookie, an edited one, an
// expired one and an old unsigned one are all refused.
// Run: npx tsx scripts/test-session-signing.ts
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";

import crypto from "crypto";
import { encodeSession, decodeSession, seedSecretOk, resignSession } from "../lib/auth";
import type { NextRequest } from "next/server";
import type { SessionPayload } from "../lib/types";

let fails = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) fails++;
}

const viewer: SessionPayload = { userId: "u1", email: "v@example.com", name: "V", role: "viewer" };
const good = encodeSession(viewer);
check("a cookie we signed decodes", decodeSession(good)?.email === "v@example.com");
check("the expiry is not handed back as a session field", !("exp" in (decodeSession(good) ?? {})));

// The old format: plain base64(JSON). This is the forgery the change exists to stop.
const forged = Buffer.from(JSON.stringify({ ...viewer, role: "super_admin" })).toString("base64");
check("an unsigned base64 cookie claiming super_admin is refused", decodeSession(forged) === null);

// Edit the payload of a real cookie, keep its signature.
const [v, body, sig] = good.split(".");
const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
const edited = Buffer.from(JSON.stringify({ ...payload, role: "super_admin" })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
check("a signed cookie with its role edited is refused", decodeSession(`${v}.${edited}.${sig}`) === null);
check("a truncated signature is refused", decodeSession(`${v}.${body}.${sig.slice(0, -2)}`) === null);
check("garbage is refused", decodeSession("not-a-cookie") === null);

const expired = encodeSession(viewer, -10);
check("an expired cookie is refused", decodeSession(expired) === null);

process.env.SESSION_SECRET = "a-different-secret-on-another-deploy";
check("a cookie signed with another deployment's key is refused", decodeSession(good) === null);

// A report link and a session come from the same secret on most deployments.
// A token signed the report-link way (plain HMAC with the raw secret) must
// never pass as a session.
process.env.SESSION_SECRET = "";
process.env.REPORT_LINK_SECRET = "shared-secret-for-links-and-sessions";
const linkStyleBody = Buffer.from(JSON.stringify({ ...viewer, role: "super_admin", exp: 9999999999 })).toString("base64url");
const linkStyleSig = crypto.createHmac("sha256", "shared-secret-for-links-and-sessions").update(linkStyleBody).digest("base64url");
check("a token signed like a report link is refused as a session", decodeSession(`v1.${linkStyleBody}.${linkStyleSig}`) === null);
check("REPORT_LINK_SECRET alone still signs sessions", decodeSession(encodeSession(viewer))?.userId === "u1");
process.env.REPORT_LINK_SECRET = "";
process.env.CRON_SECRET = "cron-only-deployment-secret";
check("CRON_SECRET alone still signs sessions (same chain as report links)", decodeSession(encodeSession(viewer))?.userId === "u1");

// Re-signing (avatar, password change) keeps the original expiry.
const short = encodeSession(viewer, 60);
const fakeReq = (c: string) => ({ cookies: { get: () => ({ value: c }) } }) as unknown as NextRequest;
const re = resignSession(fakeReq(short), { ...viewer, name: "Renamed" });
const expOf = (c: string) => JSON.parse(Buffer.from(c.split(".")[1], "base64url").toString()).exp;
check("a re-signed cookie keeps the ORIGINAL expiry, not a fresh 24h", expOf(re) === expOf(short));
check("the re-signed cookie carries the change", decodeSession(re)?.name === "Renamed");
let threw = false;
try { resignSession(fakeReq("garbage"), viewer); } catch { threw = true; }
check("re-signing with no valid cookie is refused", threw);

process.env.SUPER_ADMIN_SEED_SECRET = "oj-seed-2026";
check("the short seed secret once published in CLAUDE.md never opens the seed routes", !seedSecretOk("oj-seed-2026"));
process.env.SUPER_ADMIN_SEED_SECRET = "x".repeat(40);
check("a long seed secret matches itself", seedSecretOk("x".repeat(40)));
check("a long seed secret refuses a wrong value", !seedSecretOk("y".repeat(40)));
check("a missing header is refused", !seedSecretOk(null));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
