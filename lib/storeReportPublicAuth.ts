/* ──────────────────────────────────────────────────────────────
   Shared context resolution for the PUBLIC store-report endpoints
   (phantom count save + phantom export).

   These endpoints have no login — the /r page is deliberately open, any rep may
   open any store's report. So nothing that identifies WHAT is being acted on may
   come from the request body:

     • WHICH STORE / PERIOD comes from the signed report link (`r`). It is
       HMAC-signed and self-expiring, so a caller can't point the export at a
       different store or a period they were never sent.
     • WHO THE REP IS comes from the send's TrackRecord, looked up by the
       tracking token (`t` + `d`) exactly as the claim endpoint does. A test send
       or a preview has no tracking token — then we simply have no rep, which is
       fine for a download and only costs the "copy me in" address on an email.

   The body is trusted for one thing only: the counts the rep typed.
   ────────────────────────────────────────────────────────────── */

import { verifyReportLink } from "./reportLink";
import { getTrackingDay, type TrackRecord } from "./storeReportTracking";

export interface PublicReportContext {
  site: string;
  clientId?: string;
  year?: number;
  month?: number;
  week?: number;
  track: TrackRecord | null;
  repEmail: string;
  repName: string;
}

export type PublicResolve =
  | { ok: true; ctx: PublicReportContext }
  | { ok: false; status: number; error: string };

export async function resolvePublicContext(body: Record<string, unknown>): Promise<PublicResolve> {
  const linkToken = String(body.r ?? "").trim();
  if (!linkToken) {
    return { ok: false, status: 400, error: "This report link is missing its token. Please reopen the report from your email." };
  }

  const link = verifyReportLink(linkToken);
  if (!link.ok) {
    const error = link.reason === "expired"
      ? "This report link has expired. Check in at the store again for a fresh report."
      : "This report link isn't valid. Please open the report from your original email.";
    return { ok: false, status: link.reason === "expired" ? 410 : 400, error };
  }

  // Rep identity is best-effort — a preview / test send has no tracking record.
  let track: TrackRecord | null = null;
  const t = String(body.t ?? "").trim();
  const d = String(body.d ?? "").trim();
  if (t && d) {
    try {
      const records = await getTrackingDay(d);
      track = records.find((r) => r.token === t) ?? null;
    } catch (err) {
      console.error("phantom: tracking lookup failed", err);
    }
  }

  return {
    ok: true,
    ctx: {
      site: link.payload.site,
      clientId: link.payload.clientId,
      year: link.payload.year,
      month: link.payload.month,
      week: link.payload.week,
      track,
      repEmail: track?.repEmail ?? "",
      repName: track?.repName ?? "",
    },
  };
}
