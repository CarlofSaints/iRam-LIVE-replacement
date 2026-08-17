/* Which period a report is FOR — the "Jul 2026 Wk4" on every sheet header and
   in every filename.

   Vital Signs and Month-End both resolve this, and both used to do it like so:

     const latestMeta = ledgerResults.find(({ meta }) => meta?.reportYear)?.meta;

   `.find()` returns the FIRST ledger that happens to carry a stamp — in channel
   order, not period order. So a client whose oldest channel was last stamped
   Wk1 got "Wk1" on every report where the user left a box on Auto, no matter
   how recent the data was. It looked like the report ignoring the selection,
   and it hit every client, because channel order has nothing to do with time.

   Resolution order per field, independently:
     1. what the user explicitly chose
     2. the LATEST stamped period across the ledgers being reported on
     3. a last-resort derived from today

   Year, month and week resolve independently on purpose: a user may pin the
   month and leave the week on Auto, and that should still work.               */

export interface PeriodStamp {
  reportYear?: number;
  reportMonth?: number;
  reportWeek?: number;
}

export interface PeriodChoice {
  year?: string | number | null;
  month?: string | number | null;
  week?: string | number | null;
}

export interface ResolvedPeriod {
  year: number;
  month: number;
  week: number;
  /* Where each field came from — "chosen" when the user picked it, "stamped"
     when it came off the latest ledger, "fallback" when we had nothing. Lets a
     caller report what it actually used instead of asserting a confident label
     it inferred. */
  source: { year: Source; month: Source; week: Source };
  label: string;            // "Jul 2026 Wk4"
  filePart: string;         // "202607Wk4"
}

export type Source = "chosen" | "stamped" | "fallback";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function intOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

// Order stamps by the period they describe, so "latest" means latest in TIME.
function stampScore(s: PeriodStamp): number {
  return (s.reportYear ?? 0) * 10000 + (s.reportMonth ?? 0) * 100 + (s.reportWeek ?? 0);
}

/* The most recent stamp across the ledgers in scope. A ledger with no year is
   not a candidate — an unstamped ledger tells us nothing about the period, and
   treating its blank as year 0 would be the same "first, not latest" mistake in
   a different costume. */
export function latestStamp(stamps: (PeriodStamp | null | undefined)[]): PeriodStamp | null {
  let best: PeriodStamp | null = null;
  for (const s of stamps) {
    if (!s || !s.reportYear) continue;
    if (!best || stampScore(s) > stampScore(best)) best = s;
  }
  return best;
}

export function resolveReportPeriod(
  stamps: (PeriodStamp | null | undefined)[],
  choice: PeriodChoice,
  now: Date = new Date(),
): ResolvedPeriod {
  const latest = latestStamp(stamps);

  const chosenY = intOrNull(choice.year);
  const chosenM = intOrNull(choice.month);
  const chosenW = intOrNull(choice.week);

  const year = chosenY ?? latest?.reportYear ?? now.getFullYear();
  const month = chosenM ?? latest?.reportMonth ?? (now.getMonth() + 1);
  const week = chosenW ?? latest?.reportWeek ?? Math.ceil(now.getDate() / 7);

  const src = (chosen: number | null, stamped: number | undefined): Source =>
    chosen !== null ? "chosen" : (stamped !== undefined ? "stamped" : "fallback");

  return {
    year, month, week,
    source: {
      year: src(chosenY, latest?.reportYear),
      month: src(chosenM, latest?.reportMonth),
      week: src(chosenW, latest?.reportWeek),
    },
    label: `${MONTHS[month] || month} ${year} Wk${week}`,
    filePart: `${year}${String(month).padStart(2, "0")}Wk${week}`,
  };
}

/* ── Which VENDOR(S) a report file actually contains ──────────────────────────

   Both report routes used to name the file `client.vendorNumbers[0]`, which is
   whichever vendor happens to sort first on the client record — nothing to do
   with what is inside. VERIGREEN is 9677 on MAKRO and 1544 on MASSBUILD, so
   their MAKRO Month-End downloaded as "… - 1544 - …" while every row in it was
   9677 (Carl, 17 Aug 2026). A report that mislabels its own vendor is worse
   than one with no vendor in the name at all.

   The rows are the truth: `parseDispo` resolves a vendor per row and stamps
   `_vendor`, and it survives the merge and the enrichment. So read the file's
   own rows, and order them by the client's declared list purely so the name is
   stable between runs. A vendor present in the data but NOT declared on the
   client is still named — that disagreement is worth seeing, not hiding. */

const MAX_NAMED_VENDORS = 5;

export function reportVendorPart(
  rows: { [k: string]: unknown }[],
  declared: string[] | undefined,
): string {
  const present = new Set<string>();
  for (const r of rows) {
    const v = String(r["_vendor"] ?? "").trim();
    if (v) present.add(v);
  }

  // No row carries a vendor (a legacy ledger, or an empty report) — fall back
  // to what the client declares rather than leaving the name blank.
  if (present.size === 0) return (declared ?? []).join("+");

  const order = (declared ?? []).filter((v) => present.has(v));
  const extra = [...present].filter((v) => !order.includes(v)).sort();
  const all = [...order, ...extra];

  if (all.length <= MAX_NAMED_VENDORS) return all.join("+");
  return `${all.slice(0, MAX_NAMED_VENDORS).join("+")}+${all.length - MAX_NAMED_VENDORS}more`;
}
