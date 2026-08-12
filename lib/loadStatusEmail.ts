/* ──────────────────────────────────────────────────────────────
   Renders the weekly DISPO load-status email.

   Pure rendering — takes the computed status from lib/loadStatus.ts and
   returns { subject, html }. lib/email.ts posts it via Resend. Type-only
   import of the status shape, so there is no runtime import cycle
   (loadStatus → email → loadStatusEmail).
   ────────────────────────────────────────────────────────────── */

import type { LoadStatusResult, OutstandingVendor } from "./loadStatus";

type Status = Omit<LoadStatusResult, "recipients" | "emailed" | "failures">;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// "Grant Smith" → "Grant". Falls back to a neutral greeting for an
// address with no user record behind it.
function firstName(name: string): string {
  const first = (name || "").trim().split(/\s+/)[0];
  return first || "there";
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function lastLoadedLabel(v: OutstandingVendor): string {
  if (v.neverLoaded) return "never loaded";
  if (!v.lastLoadedAt) return "—";
  const d = new Date(v.lastLoadedAt);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", year: "numeric",
  });
}

// One <tr> per outstanding vendor, with the client name only on its first row
// so the eye groups them without needing a nested table.
function outstandingRows(outstanding: OutstandingVendor[]): string {
  const CELL = "padding:7px 10px;font-size:13px;border-bottom:1px solid #EDF2F7;vertical-align:top;";
  return outstanding.map((v, i) => {
    const firstOfClient = i === 0 || outstanding[i - 1].clientId !== v.clientId;
    const clientCell = firstOfClient
      ? `<span style="font-weight:700;color:#2D3748;">${esc(v.clientName)}</span>`
      : `<span style="color:#A0AEC0;font-size:12px;">&#8627;</span>`;

    let missing: string;
    if (v.neverLoaded) {
      missing = `<span style="color:#C53030;font-weight:600;">No DISPO ever loaded</span>`;
    } else if (v.partial) {
      missing = `${esc(v.missingChannels.join(", "))} <span style="color:#B7791F;font-size:11px;font-weight:600;">(partial)</span>`;
    } else {
      missing = esc(v.missingChannels.join(", "));
    }

    return `<tr>
      <td style="${CELL}">${clientCell}</td>
      <td style="${CELL}font-family:monospace;color:#2D3748;">${esc(v.vendorNumber)}</td>
      <td style="${CELL}color:#4A5568;">${missing}</td>
      <td style="${CELL}color:#718096;white-space:nowrap;">${esc(lastLoadedLabel(v))}</td>
    </tr>`;
  }).join("");
}

export function renderLoadStatusEmail(params: {
  name: string;
  status: Status;
}): { subject: string; html: string } {
  const s = params.status;
  const allIn = s.outstandingVendors === 0;

  const period = s.periodLabel ?? "this week";
  const subject = allIn
    ? `DISPO Load Status — all ${s.vendorCount} vendors loaded for ${period} — ${s.asAtLabel}`
    : `DISPO Load Status — ${s.outstandingVendors} of ${s.vendorCount} ${plural(s.outstandingVendors, "vendor", "vendors")} outstanding for ${period} — ${s.asAtLabel}`;

  const TH = "padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#718096;text-align:left;border-bottom:2px solid #E2E8F0;";

  const excludedNote = s.excludedVendors > 0
    ? `<p style="font-size:13px;color:#718096;margin:0 0 12px;line-height:1.6;">
         ${s.excludedVendors} ${plural(s.excludedVendors, "vendor is", "vendors are")} marked <strong>Skip</strong> on the
         load checklist${s.excludedPeriodLabel ? ` for ${esc(s.excludedPeriodLabel)}` : ""} and ${plural(s.excludedVendors, "is", "are")} excluded from the count above.
       </p>`
    : "";

  const listBlock = allIn
    ? `<p style="margin:0;padding:14px 16px;background:#F0FFF4;border-left:4px solid #7CC042;border-radius:4px;font-size:14px;color:#276749;">
         Every vendor has a DISPO loaded for ${esc(period)} — nothing outstanding.
       </p>`
    : `<p style="font-size:14px;color:#2D3748;margin:0 0 10px;font-weight:600;">
         Clients and vendors with no DISPO loaded for ${esc(period)}:
       </p>
       <table style="width:100%;border-collapse:collapse;margin:0 0 4px;">
         <thead>
           <tr>
             <th style="${TH}">Client</th>
             <th style="${TH}">Vendor</th>
             <th style="${TH}">Channel(s) outstanding</th>
             <th style="${TH}">Last loaded</th>
           </tr>
         </thead>
         <tbody>${outstandingRows(s.outstanding)}</tbody>
       </table>
       <p style="font-size:12px;color:#A0AEC0;margin:10px 0 0;line-height:1.6;">
         <strong>(partial)</strong> means some of that vendor&rsquo;s channels came in for ${esc(period)} and the ones listed did not.
         A vendor counts as loaded only once every channel it normally loads on has come in.
       </p>`;

  // ── SharePoint filing ──
  // Loaded and filed are two different obligations; a DISPO can be in the app
  // and nowhere on SharePoint. Reported as its own block so it never dilutes
  // the outstanding-loads list above.
  const f = s.filing;
  let filingBlock = "";
  if (f) {
    if (!f.ran) {
      filingBlock = `
        <p style="margin:0;padding:12px 14px;background:#FFFAF0;border-left:4px solid #DD6B20;border-radius:4px;font-size:13px;color:#7B341E;">
          <strong>SharePoint filing check did not run.</strong> ${esc(f.error ?? "Unknown error")}
        </p>`;
    } else if (f.problems.length === 0 && f.unmatched.length === 0) {
      filingBlock = `
        <p style="margin:0;padding:12px 14px;background:#F0FFF4;border-left:4px solid #7CC042;border-radius:4px;font-size:13px;color:#276749;">
          All ${f.filed} of ${f.checked} ${plural(f.checked, "client", "clients")} that loaded a DISPO for ${esc(period)} also filed it in SharePoint.
        </p>`;
    } else {
      const rows = [...f.problems, ...f.unmatched].map((p) => `
        <tr>
          <td style="padding:7px 10px;font-size:13px;border-bottom:1px solid #EDF2F7;font-weight:700;color:#2D3748;">${esc(p.clientName)}</td>
          <td style="padding:7px 10px;font-size:13px;border-bottom:1px solid #EDF2F7;color:#C05621;">${esc(p.verdict)}</td>
          <td style="padding:7px 10px;font-size:12px;border-bottom:1px solid #EDF2F7;color:#718096;font-family:monospace;">${esc(p.expectedPath)}</td>
        </tr>`).join("");
      filingBlock = `
        <p style="font-size:14px;color:#2D3748;margin:0 0 4px;font-weight:600;">
          Loaded into iRam LIVE but not filed in SharePoint:
        </p>
        <p style="font-size:12px;color:#A0AEC0;margin:0 0 10px;line-height:1.6;">
          ${f.filed} of ${f.checked} ${plural(f.checked, "client", "clients")} filed correctly. Every DISPO loaded for ${esc(period)}
          should also be saved under its client&rsquo;s
          <strong>DISPO&rsquo;s &amp; DATA SOURCES/${s.currentPeriod?.year ?? ""}/${s.currentPeriod ? `${s.currentPeriod.year}-${String(s.currentPeriod.month).padStart(2, "0")}` : ""}/W${s.currentPeriod?.week ?? ""}</strong> folder.
        </p>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="${TH}">Client</th><th style="${TH}">Problem</th><th style="${TH}">Expected folder</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
  }

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;background:#ffffff;">
      <div style="background:#7CC042;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="color:#ffffff;font-size:20px;margin:0;font-weight:700;">DISPO Load Status</h1>
        <p style="color:rgba(255,255,255,0.9);font-size:13px;margin:6px 0 0;">${esc(s.windowLabel)}</p>
      </div>
      <div style="padding:28px 32px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
        <p style="font-size:15px;color:#2D3748;margin:0 0 16px;">Hi ${esc(firstName(params.name))},</p>

        <p style="font-size:14px;color:#4A5568;margin:0 0 14px;line-height:1.7;">
          iRam has <strong>${s.clientCount}</strong> ${plural(s.clientCount, "client", "clients")} in the iRam LIVE system,
          covering <strong>${s.vendorCount}</strong> vendor ${plural(s.vendorCount, "number", "numbers")}.
        </p>
        <p style="font-size:14px;color:#4A5568;margin:0 0 14px;line-height:1.7;">
          For <strong>${esc(period)}</strong>, DISPOs have been loaded for <strong>${s.loadedVendors}</strong>
          ${plural(s.loadedVendors, "vendor", "vendors")}, which means
          <strong style="color:${allIn ? "#276749" : "#C53030"};">${s.outstandingVendors}</strong>
          ${plural(s.outstandingVendors, "has", "have")} not been loaded.
        </p>
        <p style="font-size:13px;color:#718096;margin:0 0 14px;line-height:1.7;">
          ${s.loadsThisWeek > 0
            ? `${s.loadsThisWeek} DISPO ${plural(s.loadsThisWeek, "file", "files")} ${plural(s.loadsThisWeek, "was", "were")} received since Monday
               &mdash; <strong>${s.currentPeriodLoads}</strong> for ${esc(period)}${
                 s.historicalLoads > 0
                   ? ` and <strong>${s.historicalLoads}</strong> ${plural(s.historicalLoads, "back-load", "back-loads")} for earlier periods.
                       Back-loads do not count towards the figures above.`
                   : `.`
               }`
            : `No DISPO files have been received since Monday.`}
        </p>
        ${excludedNote}

        <div style="margin:22px 0 0;">${listBlock}</div>
        ${filingBlock ? `<div style="margin:26px 0 0;padding-top:20px;border-top:1px solid #E2E8F0;">${filingBlock}</div>` : ""}

        <p style="font-size:12px;color:#A0AEC0;margin:22px 0 0;line-height:1.6;">
          Counted on the period stamped on the file, not on when it was uploaded${
            s.periodOpenedLabel ? ` &mdash; ${esc(period)} opened when its first DISPO was loaded on ${esc(s.periodOpenedLabel)}` : ""
          }. This matches the newest column of the DISPO Load Checklist. As at ${esc(s.asAtLabel)} (SAST).
        </p>
        <div style="margin-top:24px;padding-top:18px;border-top:1px solid #E2E8F0;text-align:center;">
          <p style="font-size:12px;color:#A0AEC0;margin:0;">Powered by <strong style="color:#718096;">OuterJoin</strong></p>
        </div>
      </div>
    </div>
  `;

  return { subject, html };
}
