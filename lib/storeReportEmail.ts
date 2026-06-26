/* ──────────────────────────────────────────────────────────────
   Store Report — summary EMAIL renderer.

   The "teaser" email (matches Mark Blackburn's ARIA layout): navy
   "STOCK ACTION REPORT" banner, a grid of KPI cards, the items-to-action
   total, a big "Open your report" button to the hosted action-list page,
   and a branded footer (iRam · OUTERJOIN · the store's own retailer logo —
   Makro / Builders Warehouse, never PnP).

   Table-based, inline-styled HTML so Outlook renders it faithfully.
   ────────────────────────────────────────────────────────────── */

import type { StoreReport } from "./storeReport";

export interface StoreReportEmailMeta {
  repName: string;
  periodLabel: string;       // e.g. "Week ending 25 Jun 2026" or "Wk 4 · Jun 2026"
  reportUrl: string;         // hosted action-list page link
  generatedAt: string;       // "26 Jun 2026 at 13:36"
  version: string;           // "iRam LIVE v1.0.0"
  iramLogoUrl?: string;      // data: URL or https
  outerjoinLogoUrl?: string;
  retailerLogoUrl?: string;  // store's own main-channel logo (Makro / Builders)
}

const NAVY = "#1c3d5a";
const NAVY_DARK = "#16314a";
const RED = "#df332c";
const GREEN = "#2e9e5b";
const BLUE = "#1f5fa8";
const GREY = "#6b7280";

interface Card { label: string; value: number; color: string }

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cardCell(c: Card): string {
  return `
    <td width="33%" align="center" valign="top" style="padding:5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.color};border-radius:6px;">
        <tr><td align="center" style="padding:16px 6px;">
          <div style="font:700 30px/1 Arial,Helvetica,sans-serif;color:#ffffff;">${c.value}</div>
          <div style="font:600 11px/1.3 Arial,Helvetica,sans-serif;color:#ffffff;margin-top:6px;text-transform:none;">${esc(c.label)}</div>
        </td></tr>
      </table>
    </td>`;
}

function cardRow(cards: Card[]): string {
  return `<tr>${cards.map(cardCell).join("")}</tr>`;
}

export function renderStoreReportEmail(report: StoreReport, meta: StoreReportEmailMeta): string {
  const cards: Card[] = [
    { label: "Out of Stock", value: report.counts.oos, color: RED },
    { label: "Low Stock Cover", value: report.counts.lowCover, color: RED },
    { label: "Phantom", value: report.counts.phantom, color: RED },
    { label: "Status", value: report.counts.status, color: RED },
    { label: "Margin Risk", value: report.counts.marginRisk, color: RED },
    { label: "Margin Opportunity", value: report.counts.marginOpp, color: GREEN },
  ];

  const subline = [report.siteCode, report.subChannel, meta.periodLabel]
    .filter(Boolean).map(esc).join(" &middot; ");

  const logo = (url: string | undefined, alt: string) =>
    url ? `<img src="${esc(url)}" alt="${esc(alt)}" height="26" style="height:26px;display:inline-block;vertical-align:middle;">`
        : `<span style="font:600 12px Arial,Helvetica,sans-serif;color:#9aa3ad;">${esc(alt)}</span>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">

  <!-- greeting -->
  <tr><td style="padding:22px 28px 4px 28px;font:400 15px Arial,Helvetica,sans-serif;color:#33404d;">
    Hello ${esc(meta.repName)},
  </td></tr>

  <!-- banner -->
  <tr><td style="padding:14px 28px 0 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-radius:6px;">
      <tr><td style="background:${NAVY_DARK};padding:10px 18px;font:700 11px Arial,Helvetica,sans-serif;color:#aebfcf;letter-spacing:1px;">
        STOCK ACTION REPORT
      </td></tr>
      <tr><td style="padding:14px 18px 18px 18px;">
        <div style="font:700 26px Arial,Helvetica,sans-serif;color:#ffffff;">${esc(report.storeName || report.siteCode)}</div>
        <div style="font:400 13px Arial,Helvetica,sans-serif;color:#b9c6d4;margin-top:6px;">${subline}</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- cards -->
  <tr><td style="padding:18px 22px 4px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${cardRow(cards.slice(0, 3))}
      ${cardRow(cards.slice(3, 6))}
    </table>
  </td></tr>

  <!-- total -->
  <tr><td align="center" style="padding:10px 28px 4px 28px;font:400 15px Arial,Helvetica,sans-serif;color:#33404d;">
    <b style="color:${NAVY};">${report.totalActions}</b> items to action this week
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:14px 28px 6px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BLUE};border-radius:6px;">
      <tr><td align="center" style="padding:20px;">
        <a href="${esc(meta.reportUrl)}" style="text-decoration:none;display:block;">
          <div style="font:700 18px Arial,Helvetica,sans-serif;color:#ffffff;">Open your report &rarr;</div>
          <div style="font:400 12px Arial,Helvetica,sans-serif;color:#cfe0f2;margin-top:4px;">Your store&rsquo;s stock action list</div>
        </a>
      </td></tr>
    </table>
  </td></tr>

  <!-- helper -->
  <tr><td align="center" style="padding:10px 36px 18px 36px;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:${GREY};">
    Tap the report above to open this week&rsquo;s stock action list &mdash; your in-store punch-list of what to fix.<br>
    The link stays live for the next several days; a fresh report is generated each run.
  </td></tr>

  <!-- divider -->
  <tr><td style="padding:0 28px;"><div style="border-top:1px solid #e3e7ec;"></div></td></tr>

  <!-- footer logos -->
  <tr><td align="center" style="padding:18px 28px 4px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:0 16px;">${logo(meta.iramLogoUrl, "iRAM")}</td>
      <td style="padding:0 16px;">${logo(meta.outerjoinLogoUrl, "OUTERJOIN")}</td>
      <td style="padding:0 16px;">${logo(meta.retailerLogoUrl, report.subChannel || "Retailer")}</td>
    </tr></table>
  </td></tr>

  <!-- footer meta -->
  <tr><td align="center" style="padding:8px 28px 24px 28px;font:400 11px Arial,Helvetica,sans-serif;color:#9aa3ad;">
    Generated ${esc(meta.generatedAt)} &middot; ${report.totalProducts} articles &middot; ${esc(meta.periodLabel)} &middot; ${esc(meta.version)}
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}
