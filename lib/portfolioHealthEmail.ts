/* ──────────────────────────────────────────────────────────────
   The weekly Portfolio Stock Health email.

   ── One mail per channel, scoped per recipient ─────────────────
   Each recipient sees only the clients their account is scoped to
   (`User.clientIds`). An empty list means internal staff and gets everything,
   which is how the field already works elsewhere in the app — so a client
   account cannot be handed a mail full of other suppliers' numbers by someone
   ticking a box.

   The scoping is done by re-aggregating the CUBE with a client filter, which
   is the same code path the page uses when you click a client. So a recipient's
   mail and what they see on screen after clicking their own client are
   produced by one function, and cannot drift into disagreeing.

   ── Why the freshness table is in the body ─────────────────────
   The DISPOs arrive haphazardly. Some clients land Monday, some Thursday, some
   not at all that week, so ANY fixed send time produces a mail that is part
   fresh and part days old — and there is no send time that fixes that, only
   one that hides it differently. Carl's call, and the right one: print when
   each client's data last arrived and let the reader judge. A number next to
   "last DISPO 2 September" is read correctly; the same number on its own is
   not.
   ────────────────────────────────────────────────────────────── */

import { aggregateCube, emptyFilter, type PortfolioCube } from "./portfolioCube";
import type { ClientFreshness, KpiCounts, PortfolioHealth } from "./portfolioHealth";
import type { ComparisonPoint } from "./portfolioSnapshot";

export interface PortfolioEmailRecipient {
  name: string;
  email: string;
  /** Empty = internal, sees every client. Non-empty = only these clients. */
  clientIds: string[];
}

export interface PortfolioEmailInput {
  channelName: string;
  periodLabel: string;
  captureDate: string;
  health: PortfolioHealth;
  cube: PortfolioCube | null;
  comparisons: ComparisonPoint[];
  recipient: PortfolioEmailRecipient;
  /** Absolute link back into the app. */
  reportUrl: string;
}

export interface PortfolioEmailBody {
  subject: string;
  html: string;
  /** False when this recipient's clients have nothing in this channel. */
  hasContent: boolean;
}

const MEASURES: { key: keyof KpiCounts; label: string }[] = [
  { key: "oos", label: "Out of stock" },
  { key: "lowCover", label: "Low stock cover" },
  { key: "phantom", label: "Phantom" },
  { key: "negSoh", label: "Negative SOH" },
  { key: "discontinued", label: "Discontinued with SOH" },
];

function fmt(n: number): string {
  return n.toLocaleString("en-ZA").replace(/,/g, "&nbsp;");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function niceDate(iso: string): string {
  if (!iso) return "never";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function daysAgo(iso: string, from: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return Math.floor((from.getTime() - t) / 86400000);
}

/** Lower is better everywhere here, so a fall is good news. */
function deltaCell(now: number, then: number | null | undefined): string {
  if (then === null || then === undefined) return `<span style="color:#71717a">no prior data</span>`;
  const d = now - then;
  if (d === 0) return `<span style="color:#71717a">no change</span>`;
  const worse = d > 0;
  const colour = worse ? "#dc2626" : "#059669";
  return `<span style="color:${colour}">${worse ? "▲" : "▼"}${fmt(Math.abs(d))} vs ${fmt(then)}</span>`;
}

export function buildPortfolioHealthEmail(input: PortfolioEmailInput): PortfolioEmailBody {
  const { channelName, periodLabel, captureDate, health, cube, comparisons, recipient, reportUrl } = input;
  const scoped = recipient.clientIds.length > 0;

  /* Scope by re-aggregating the cube — the same call the page makes when you
     click a client. When there is no cube (an older capture), an unscoped
     recipient still gets the stored totals, and a scoped one gets nothing,
     because showing them the whole portfolio would be the leak this exists to
     prevent. */
  const view = cube
    ? aggregateCube(cube, { ...emptyFilter(), clients: recipient.clientIds }, 10)
    : null;

  const totals: KpiCounts | null = view ? view.totals : scoped ? null : health.totals;
  if (!totals) {
    return { subject: "", html: "", hasContent: false };
  }

  const anything = MEASURES.some((m) => totals[m.key] > 0);
  if (scoped && !anything) {
    // Nothing wrong with any of their clients in this channel this week. A mail
    // saying so every Thursday forever is noise, so it is not sent.
    return { subject: "", html: "", hasContent: false };
  }

  const freshness: ClientFreshness[] = scoped
    ? health.freshness.filter((f) => recipient.clientIds.includes(f.clientId))
    : health.freshness;

  const now = new Date(captureDate.length <= 10 ? `${captureDate}T00:00:00Z` : captureDate);

  const kpiRows = MEASURES.map((m) => {
    if (m.key === "discontinued" && !health.discontinuedConfigured) {
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e4e4e7">${m.label}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e4e4e7;text-align:right;color:#b45309">Not configured</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e4e4e7;font-size:12px;color:#71717a">No status code marked as discontinued for this channel</td>
      </tr>`;
    }
    /* Comparison columns are portfolio-wide totals from older captures, which
       hold no cube, so a scoped recipient gets no arrow rather than one
       measuring their clients against everybody's. */
    const prior = comparisons.find((c) => c.label === "Previous capture");
    const cell = scoped
      ? `<span style="color:#71717a">—</span>`
      : deltaCell(totals[m.key], prior?.counts?.[m.key] ?? null);
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e4e4e7">${m.label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600;font-size:16px">${fmt(totals[m.key])}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e4e4e7;font-size:12px">${cell}</td>
    </tr>`;
  }).join("");

  const freshRows = freshness.map((f) => {
    const age = daysAgo(f.lastData, now);
    const late = age !== null && age >= 14;
    const colour = !f.lastData ? "#b45309" : late ? "#dc2626" : "#3f3f46";
    const note = !f.lastData
      ? "no DISPO recorded"
      : f.hasStaleVendor
        ? `${age} days — a vendor was excluded`
        : `${age} day${age === 1 ? "" : "s"} ago`;
    return `<tr>
      <td style="padding:5px 10px;border-bottom:1px solid #f4f4f5">${esc(f.clientName)}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #f4f4f5;color:${colour}">${niceDate(f.lastData)}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #f4f4f5;font-size:12px;color:${colour}">${note}</td>
    </tr>`;
  }).join("");

  const topSites = (view ? view.bySite : health.bySite).slice(0, 5).map((r) => `<tr>
      <td style="padding:5px 10px;border-bottom:1px solid #f4f4f5">${esc(r.extra?.storeName || r.label)}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #f4f4f5;text-align:right">${fmt(r.counts.oos)}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #f4f4f5;text-align:right">${fmt(r.counts.phantom)}</td>
    </tr>`).join("");

  const coverage = view
    ? `${fmt(view.sites)} sites &middot; ${fmt(view.clients)} clients &middot; ${fmt(view.lines)} flagged lines`
    : `${fmt(health.sites)} sites &middot; ${fmt(health.clients)} clients &middot; ${fmt(health.activeLines)} active lines`;

  const subject = scoped
    ? `${channelName} stock health — your clients — ${periodLabel}`
    : `${channelName} stock health — ${periodLabel}`;

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;max-width:680px">
  <h2 style="margin:0 0 4px">${esc(channelName)} — Portfolio Stock Health</h2>
  <p style="margin:0 0 16px;color:#52525b;font-size:14px">
    ${esc(periodLabel)} &middot; captured ${niceDate(captureDate)}<br>
    ${coverage}
    ${scoped ? `<br><span style="color:#71717a">Scoped to your clients.</span>` : ""}
  </p>

  <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:8px">
    <tbody>${kpiRows}</tbody>
  </table>
  <p style="margin:0 0 20px;font-size:12px;color:#71717a">
    Negative SOH is counted inside Out of stock, not beside it. A line can carry more than one
    measure at once, so these figures overlap and must not be added together.
  </p>

  ${topSites ? `
  <h3 style="margin:0 0 6px;font-size:14px">Worst stores</h3>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
    <thead><tr style="text-align:left;color:#71717a;font-size:12px">
      <th style="padding:4px 10px">Store</th>
      <th style="padding:4px 10px;text-align:right">Out of stock</th>
      <th style="padding:4px 10px;text-align:right">Phantom</th>
    </tr></thead>
    <tbody>${topSites}</tbody>
  </table>` : ""}

  <h3 style="margin:0 0 6px;font-size:14px">When each client's data last arrived</h3>
  <p style="margin:0 0 6px;font-size:12px;color:#71717a">
    DISPOs arrive on different days, so this report is always part fresh and part older. This is
    which is which — a figure above is only as current as the client's last upload below.
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
    <thead><tr style="text-align:left;color:#71717a;font-size:12px">
      <th style="padding:4px 10px">Client</th>
      <th style="padding:4px 10px">Last DISPO</th>
      <th style="padding:4px 10px"></th>
    </tr></thead>
    <tbody>${freshRows || `<tr><td style="padding:5px 10px;color:#71717a">No clients with data in this channel.</td></tr>`}</tbody>
  </table>

  ${health.excluded.length && !scoped ? `
  <p style="margin:0 0 20px;font-size:12px;color:#b45309">
    ${health.excluded.length} vendor${health.excluded.length === 1 ? "" : "s"} had no data for 14 days
    or more and ${health.excluded.length === 1 ? "was" : "were"} excluded from every figure above.
  </p>` : ""}

  <p style="margin:0 0 8px">
    <a href="${esc(reportUrl)}" style="background:#18181b;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:14px;display:inline-block">
      Open the full report
    </a>
  </p>
  <p style="margin:0;font-size:12px;color:#71717a">
    Click any row on the report to filter, or the arrow to see the lines behind it.
    You are receiving this because Portfolio Stock Health is ticked on your iRam LIVE account.
  </p>
</div>`.trim();

  return { subject, html, hasContent: true };
}
