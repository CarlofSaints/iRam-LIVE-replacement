/* ──────────────────────────────────────────────────────────────
   Data-coverage analysis — reusable across the app.

   Given the set of month columns present in a client's sales ledger(s)
   (canonical "MM-YYYY" keys), work out where the monthly series has holes.
   The important ones for reporting are the PRIOR-YEAR months that feed the
   year-on-year comparison: if those are missing, the LY base is understated
   and growth % reads too high (a smaller base inflates growth). Pure + UI-safe
   (no server imports) so it can run in a client component or an API route.
   ────────────────────────────────────────────────────────────── */

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DATE_KEY = /^(\d{2})-(\d{4})$/;

/** "03-2025" → "Mar 2025" (passes through anything unrecognized). */
export function formatMonth(key: string): string {
  const m = DATE_KEY.exec(key);
  return m ? `${MONTHS[parseInt(m[1], 10)]} ${m[2]}` : key;
}

export interface CoverageResult {
  /** Distinct present months, "MM-YYYY", ascending. */
  present: string[];
  firstMonth: string | null;
  lastMonth: string | null;
  /** Latest year in the data and the year before it. */
  currentYear: number | null;
  priorYear: number | null;
  /** Months missing WITHIN the present span (holes between first and last). */
  interiorGaps: string[];
  /** Prior-year months (Jan..latestMonth) absent from the YoY comparison base. */
  lyComparisonGaps: string[];
  /** Current-year months (Jan..latestMonth) absent — understates the current base. */
  currentYtdGaps: string[];
  /** Any prior-year month present at all? */
  hasPriorYearData: boolean;
  /** True when there is anything worth warning about. */
  hasGaps: boolean;
}

const toIdx = (y: number, m: number) => y * 12 + (m - 1);
const keyOf = (y: number, m: number) => `${String(m).padStart(2, "0")}-${y}`;

/**
 * Plain-text warning lines for a coverage result (empty if no gaps). Shared by
 * the dashboard tooltip and the in-workbook Data-Coverage notes so the wording
 * stays identical everywhere.
 */
export function coverageMessageLines(c: CoverageResult): string[] {
  if (!c.hasGaps) return [];
  const fmt = (arr: string[]) => arr.map(formatMonth).join(", ");
  const lines: string[] = [];

  if (!c.hasPriorYearData) {
    lines.push(
      `No prior-year (${c.priorYear}) data is loaded — year-on-year growth is not measured against a real base and should be treated as unreliable.`,
    );
  } else if (c.lyComparisonGaps.length > 0) {
    lines.push(`Prior-year (${c.priorYear}) months missing from the comparison base: ${fmt(c.lyComparisonGaps)}.`);
    lines.push(
      `Year-on-year growth (YTD and same-month-last-year) reads too high — it is measured against an incomplete ${c.priorYear} base, and a smaller base inflates the growth %.`,
    );
  }

  if (c.currentYtdGaps.length > 0) {
    lines.push(`Current-year months missing (understates the current base): ${fmt(c.currentYtdGaps)}.`);
  }

  const windowSet = new Set([...c.lyComparisonGaps, ...c.currentYtdGaps]);
  const other = c.interiorGaps.filter((m) => !windowSet.has(m));
  if (other.length > 0) lines.push(`Other gaps in the monthly series: ${fmt(other)}.`);

  return lines;
}

export function analyzeCoverage(dateColumns: string[]): CoverageResult {
  const set = new Set<string>();
  const parsed: { y: number; m: number }[] = [];
  for (const c of dateColumns) {
    const mm = DATE_KEY.exec(String(c).trim());
    if (!mm) continue;
    const key = `${mm[1]}-${mm[2]}`;
    if (!set.has(key)) {
      set.add(key);
      parsed.push({ y: parseInt(mm[2], 10), m: parseInt(mm[1], 10) });
    }
  }

  const empty: CoverageResult = {
    present: [], firstMonth: null, lastMonth: null, currentYear: null, priorYear: null,
    interiorGaps: [], lyComparisonGaps: [], currentYtdGaps: [], hasPriorYearData: false, hasGaps: false,
  };
  if (parsed.length === 0) return empty;

  parsed.sort((a, b) => toIdx(a.y, a.m) - toIdx(b.y, b.m));
  const present = parsed.map((p) => keyOf(p.y, p.m));
  const first = parsed[0];
  const last = parsed[parsed.length - 1];

  // Interior holes across the whole present span.
  const interiorGaps: string[] = [];
  for (let i = toIdx(first.y, first.m); i <= toIdx(last.y, last.m); i++) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    if (!set.has(keyOf(y, m))) interiorGaps.push(keyOf(y, m));
  }

  const currentYear = last.y;
  const latestMonth = last.m;
  const priorYear = currentYear - 1;

  // Comparison windows run Jan..latestMonth (the YTD span the reports compare).
  const currentYtdGaps: string[] = [];
  const lyComparisonGaps: string[] = [];
  for (let m = 1; m <= latestMonth; m++) {
    if (!set.has(keyOf(currentYear, m))) currentYtdGaps.push(keyOf(currentYear, m));
    if (!set.has(keyOf(priorYear, m))) lyComparisonGaps.push(keyOf(priorYear, m));
  }

  const hasPriorYearData = parsed.some((p) => p.y === priorYear);
  const hasGaps = interiorGaps.length > 0 || lyComparisonGaps.length > 0 || currentYtdGaps.length > 0;

  return {
    present, firstMonth: present[0], lastMonth: present[present.length - 1],
    currentYear, priorYear, interiorGaps, lyComparisonGaps, currentYtdGaps,
    hasPriorYearData, hasGaps,
  };
}
