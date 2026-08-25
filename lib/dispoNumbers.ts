/* Quantity columns in some SAP DISPO exports use a PERIOD as the thousands
   separator and drop trailing zeros, so 1,500 is written `1.5` and 1,525 is
   written `1.525`. Read naively those become one-point-five and one-point-five-
   two-five — a thousandfold understatement that lands straight in the ledger,
   in Vital Signs and in Month-End.

   Found 19 Aug 2026 on VERIGREEN 9677 / MAKRO / Aug-2026 Wk2: 91 cells, 74 of
   them in `Curr Y/S`, which read 41,404 units against a true 135,830.

   WE DO NOT GUESS. Every decision below comes from arithmetic the file itself
   asserts. There are two oracles, tried in that order.

   ORACLE 1 — the `**` grand-total line (Makro-style files).
   Those files list an Article×Site once per UOM and then a `**` line holding
   the grand total in BASE units — Σ(units × Compo) across the UOM lines. So we
   try both readings and keep the one the file's own arithmetic agrees with. On
   the VERIGREEN file the scaled reading reconciles 194 of 194 keys and the
   naive reading only 162.

   ORACLE 2 — a total cannot be smaller than its own parts (Massbuild-style).
   Massbuild exports carry ONE row per Article×Site and no `**` line at all, so
   Oracle 1 never fires on them — which is why USABCO/MASSBUILD loaded wrong for
   months while VERIGREEN was fixed. But those files still assert totals:

     • `Curr Y/S` is a running year-to-date figure on the same row as the months
       that feed it, so it can never be less than they sum to.
     • the keyless footer row (no Article, no Site) holds a grand total per
       column, so it can never be less than the file's own rows sum to.

   A suspect that makes either statement FALSE read plainly and TRUE read scaled
   is an arithmetic impossibility, not a judgement call. USABCO 1063 / MASSBUILD
   / Aug-2026 Wk3 says site B14 sold 1.104 units year-to-date having sold 689 in
   the six months printed beside it.

   Oracle 2 fires only behind `describeShape`'s guard — the file must count in
   whole units, never use a comma separator, and never once reach 1000 plainly.
   A file whose quantities are genuinely fractional (kg, litres) fails that guard
   and is left alone, because scaling a real decimal by 1000 is far worse than
   leaving a number small. So is a file with suspects but no oracle at all: it is
   left ALONE and reported — see `describeDetection`. */

/** Columns whose values are quantities, not prices. Date columns are added per
    file (they are dynamic); this is the fixed one that sits beside them. It is
    also a RUNNING TOTAL of those date columns, which is what makes Oracle 2
    work — see `judgeRunningTotals`. */
export const FIXED_QUANTITY_COLUMN = "Curr Y/S";

/** `1.525` / `1.5` / `2.58` — a small integer, a period, then 1-3 digits that
    are not all zero. `6.000` is excluded: that is six written to three decimal
    places, which several older DISPO exports do. */
const SUSPECT = /^(-?)(\d{1,3})\.(\d{1,3})$/;

export function isThousandsSuspect(raw: unknown): boolean {
  const m = String(raw ?? "").replace(/"/g, "").trim().match(SUSPECT);
  if (!m) return false;
  return m[3].replace(/0+$/, "") !== "";
}

/** Read a quantity the plain way: strip quotes and comma separators. */
export function readQty(raw: unknown): number {
  const s = String(raw ?? "").replace(/["\s,]/g, "").trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Read a quantity treating a period as a thousands separator, right-padding
    the group to three digits: `1.5` → 1500, `1.12` → 1120, `1.525` → 1525.
    Anything that is not a suspect is read the plain way. */
export function readQtyScaled(raw: unknown): number {
  const s = String(raw ?? "").replace(/"/g, "").trim();
  const m = s.match(SUSPECT);
  if (m && m[3].replace(/0+$/, "") !== "") {
    const v = Number(m[2]) * 1000 + Number(m[3].padEnd(3, "0"));
    return m[1] === "-" ? -v : v;
  }
  return readQty(raw);
}

/** What the quantity columns look like across the whole file. This is the guard
    on Oracle 2: it establishes that the file counts in whole units and cannot
    express a thousand any other way, so a lone `1.104` has only one sane
    reading. Every threshold here is a REASON, not a tuning knob — see `ok`. */
export interface QuantityShape {
  /** Non-empty quantity cells in the file. */
  values: number;
  /** …of those, how many match the suspect shape. */
  suspects: number;
  /** Cells written with a comma separator. One is enough to prove the export
      separates thousands with a comma, so a period must be a decimal point. */
  withComma: number;
  /** Plain readings that reach 1000. One is enough to prove the export CAN
      write a thousand without a separator, so it had no need of a period. */
  atOrAbove1000: number;
  /** Non-suspect cells that are not whole numbers. One is enough to prove the
      file legitimately carries fractions, so a period may well be a decimal. */
  otherDecimals: number;
  ok: boolean;
}

/** Cells needed before the shape of a file counts as evidence of anything. A
    handful of rows is not a corpus; 500 whole numbers with a hard ceiling at
    999 is. USABCO 1063 Aug-2026 Wk3 offers 129,200. */
const SHAPE_MIN_VALUES = 500;

/** Above this share of suspects the periods ARE the convention, not a rare tail
    of items that happened to cross a thousand. USABCO's 6 in 129,200 is 0.005%. */
const SHAPE_MAX_SUSPECT_SHARE = 0.02;

export function describeShape(
  rows: Record<string, unknown>[],
  quantityColumns: string[],
): QuantityShape {
  const s: QuantityShape = {
    values: 0, suspects: 0, withComma: 0,
    atOrAbove1000: 0, otherDecimals: 0, ok: false,
  };
  for (const r of rows) {
    for (const col of quantityColumns) {
      const raw = String(r[col] ?? "").replace(/"/g, "").trim();
      if (raw === "") continue;
      s.values++;
      if (raw.includes(",")) s.withComma++;
      const plain = readQty(raw);
      if (Math.abs(plain) >= 1000) s.atOrAbove1000++;
      if (isThousandsSuspect(raw)) s.suspects++;
      else if (!Number.isInteger(plain)) s.otherDecimals++;
    }
  }
  s.ok =
    s.values >= SHAPE_MIN_VALUES &&
    s.suspects > 0 &&
    s.withComma === 0 &&
    s.atOrAbove1000 === 0 &&
    s.otherDecimals === 0 &&
    s.suspects / s.values < SHAPE_MAX_SUSPECT_SHARE;
  return s;
}

export interface ThousandsDetection {
  /** Rewrite the quantity columns with the scaled reading? */
  applies: boolean;
  /** Which oracle decided it — for the note the user reads, and for tests. */
  basis: "none" | "star-totals" | "totals-exceed-parts";
  /** Cells matching the suspect shape, across the quantity columns — every row,
      including the keyless footer total (which Oracle 2 reads as a witness). */
  suspects: number;
  /** (Article|Site, column) pairs containing a suspect that the `**` line could
      be used to judge. */
  judged: number;
  /** …of those, how many reconcile under each reading. */
  reconciledPlain: number;
  reconciledScaled: number;
  /** …of those, how many the `**` line actually DISCRIMINATES between. Where a
      group sells in one UOM only, its `**` line is a copy of the selling row,
      so it reconciles whichever way you read it and settles nothing. Counting
      those as a verdict let Oracle 1 silently veto Oracle 2 on files it had no
      opinion about — CARTOON CANDY 8149 Jul-2026 Wk1 among them. */
  informative: number;
  /** Suspect cells sitting in a group with no `**` line — unjudgeable by Oracle
      1. Oracle 2 may still reach them; whatever it cannot reach is left as it is
      and worth telling the user about. */
  unjudged: number;
  /** Oracle 2: totals the plain reading makes smaller than their own parts. */
  impossiblePlain: number;
  /** …of those, how many the scaled reading makes whole again. */
  repairedByScaling: number;
  /** The file-wide guard Oracle 2 sits behind. */
  shape: QuantityShape;
}

const uomOf = (r: Record<string, unknown>) => String(r["UOM"] ?? "").trim();
const isTotalRow = (r: Record<string, unknown>) => uomOf(r) === "**";

const articleSiteKey = (r: Record<string, unknown>) => {
  const a = String(r["Article"] ?? "").trim().toLowerCase();
  const s = String(r["Site"] ?? "").trim().toLowerCase();
  return a && s ? `${a}|${s}` : "";
};

function groupByArticleSite(
  rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>[]> {
  const g = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const k = articleSiteKey(r);
    if (!k) continue;
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(r);
  }
  return g;
}

/**
 * ORACLE 2 — count the totals in this file that the plain reading makes smaller
 * than the parts they are the total OF, and how many of those the scaled
 * reading repairs. Both statements are the file's own arithmetic:
 *
 *   • a row's `Curr Y/S` against the months printed on that same row;
 *   • the keyless footer row against the sum of the file's keyed rows.
 *
 * `partColumns` are the date columns; `totalColumn` is `Curr Y/S`.
 *
 * The row test uses the LARGEST single month, not the sum of them, and that is
 * deliberate. The date columns carry a same-month-last-year comparison beside
 * the current-year months (`Aug25` sits next to `Apr26`…`Aug26`), so their sum
 * is not a quantity `Curr Y/S` is the total of — summing them would set the bar
 * BOTH too high to confirm a scaled reading and too low to declare a plain one
 * impossible. "A year to date cannot be less than one of its own months" needs
 * no such assumption and errs towards leaving the file alone.
 */
export function judgeRunningTotals(
  rows: Record<string, unknown>[],
  partColumns: string[],
  totalColumn: string,
  onRepair?: (row: Record<string, unknown>, column: string) => void,
): { impossiblePlain: number; repairedByScaling: number } {
  let impossiblePlain = 0;
  let repairedByScaling = 0;

  const consider = (row: Record<string, unknown>, col: string, parts: number) => {
    const raw = row[col];
    if (!isThousandsSuspect(raw)) return;
    if (parts <= 0) return;                      // nothing asserted
    // A total below its own parts is impossible however you read it — the
    // question is only whether scaling is what makes it possible again.
    if (readQty(raw) >= parts) return;
    impossiblePlain++;
    if (readQtyScaled(raw) < parts) return;
    repairedByScaling++;
    onRepair?.(row, col);
  };

  // (a) each row's running total against the biggest month on that same row.
  // A `**` line is included: whatever unit it is written in, its own months sit
  // beside it in that same unit, so the statement still holds.
  for (const r of rows) {
    if (!articleSiteKey(r)) continue;            // footer rows handled below
    const biggestMonth = partColumns.reduce((a, c) => Math.max(a, readQty(r[c])), 0);
    consider(r, totalColumn, biggestMonth);
  }

  // (b) the keyless footer row against the file's own column sums. The footer
  // spans the whole report (both vendor files of a Massbuild pair carry the
  // same one), so it is always >= this file's sum — never less.
  const allColumns = [...partColumns, totalColumn];
  const footers = rows.filter(
    (r) => !articleSiteKey(r) && allColumns.some((c) => String(r[c] ?? "").trim() !== ""),
  );
  if (footers.length > 0) {
    const columnSum = new Map<string, number>();
    for (const col of allColumns) {
      let sum = 0;
      for (const r of rows) {
        if (articleSiteKey(r) && !isTotalRow(r)) sum += readQty(r[col]);
      }
      columnSum.set(col, sum);
    }
    for (const f of footers) {
      for (const col of allColumns) consider(f, col, columnSum.get(col) ?? 0);
    }
  }

  return { impossiblePlain, repairedByScaling };
}

/**
 * Decide, from the file's own arithmetic, whether the quantity columns encode
 * thousands with a period. Oracle 1 (`**` totals) wins where it applies;
 * Oracle 2 (totals vs parts, behind the shape guard) covers the Massbuild-style
 * files that have no `**` line.
 */
export function detectPeriodThousands(
  rows: Record<string, unknown>[],
  quantityColumns: string[],
): ThousandsDetection {
  const out: ThousandsDetection = {
    applies: false, basis: "none", suspects: 0, judged: 0,
    reconciledPlain: 0, reconciledScaled: 0, informative: 0, unjudged: 0,
    impossiblePlain: 0, repairedByScaling: 0,
    shape: {
      values: 0, suspects: 0, withComma: 0,
      atOrAbove1000: 0, otherDecimals: 0, ok: false,
    },
  };
  if (quantityColumns.length === 0) return out;

  // Count every suspect in the file, not just the ones sitting under an
  // Article|Site key — the keyless footer total carries them too, and a count
  // that disagreed with the number of cells actually rescaled would be a lie.
  for (const r of rows) {
    for (const col of quantityColumns) if (isThousandsSuspect(r[col])) out.suspects++;
  }

  const groups = groupByArticleSite(rows);
  let judgedSuspects = 0;

  for (const members of groups.values()) {
    const total = members.find(isTotalRow);
    const parts = members.filter((r) => !isTotalRow(r));

    for (const col of quantityColumns) {
      const cells = members.map((r) => r[col]);
      const suspectsHere = cells.filter(isThousandsSuspect).length;
      if (suspectsHere === 0) continue;

      if (!total || parts.length === 0) continue;
      out.judged++;
      judgedSuspects += suspectsHere;

      // The `**` line equals Σ(units × Compo) over the UOM lines. Compo is a
      // pack size, never thousands-encoded, so it is read plainly either way.
      const compo = (r: Record<string, unknown>) => {
        const c = readQty(r["Compo"]);
        return c > 0 ? c : 1;
      };
      const plainSum = parts.reduce((a, r) => a + readQty(r[col]) * compo(r), 0);
      const scaledSum = parts.reduce((a, r) => a + readQtyScaled(r[col]) * compo(r), 0);
      const okPlain = Math.abs(readQty(total[col]) - plainSum) < 0.01;
      const okScaled = Math.abs(readQtyScaled(total[col]) - scaledSum) < 0.01;
      if (okPlain) out.reconciledPlain++;
      if (okScaled) out.reconciledScaled++;
      if (okPlain !== okScaled) out.informative++;
    }
  }

  out.unjudged = out.suspects - judgedSuspects;

  // Oracle 1. Only act on a clear, unanimous win: every judgeable case must
  // agree with the scaled reading, and the plain reading must actually be worse
  // — otherwise there is nothing to fix.
  if (
    out.judged > 0 &&
    out.reconciledScaled === out.judged &&
    out.reconciledScaled > out.reconciledPlain
  ) {
    out.applies = true;
    out.basis = "star-totals";
    return out;
  }

  // Oracle 2. Only where Oracle 1 had nothing to say — if any `**` line
  // actually discriminated between the two readings and did not vote for
  // scaling, that verdict stands. A `**` line that reconciles both ways has
  // not voted at all, and must not be read as a "no".
  if (out.informative > 0 || out.suspects === 0) return out;

  out.shape = describeShape(rows, quantityColumns);
  const partColumns = quantityColumns.filter((c) => c !== FIXED_QUANTITY_COLUMN);
  const verdict = judgeRunningTotals(rows, partColumns, FIXED_QUANTITY_COLUMN);
  out.impossiblePlain = verdict.impossiblePlain;
  out.repairedByScaling = verdict.repairedByScaling;

  if (out.shape.ok && out.repairedByScaling > 0) {
    out.applies = true;
    out.basis = "totals-exceed-parts";
    // Oracle 2 does NOT license rewriting the whole file — only the cells it
    // can actually vouch for. LIBRA MARKETING 119 Aug-2026 Wk3 is why: it sells
    // SKI ROPE by the metre, so `Jul26 = 1.5` is a real metre and a half, while
    // the `Curr Y/S` on another row is a real 1,065. The file passes the shape
    // guard, and scaling all of it would have turned that rope into 1,500m.
    out.unjudged = out.suspects - out.repairedByScaling;
  }

  return out;
}

/**
 * Rescale only the cells ORACLE 2 vouched for — a total the plain reading put
 * below its own parts. Returns the number of cells changed. Oracle 1's verdict
 * is file-wide and uses `applyPeriodThousands` instead.
 */
export function applyWitnessedThousands(
  rows: Record<string, unknown>[],
  quantityColumns: string[],
): number {
  let changed = 0;
  const partColumns = quantityColumns.filter((c) => c !== FIXED_QUANTITY_COLUMN);
  judgeRunningTotals(rows, partColumns, FIXED_QUANTITY_COLUMN, (row, col) => {
    row[col] = readQtyScaled(row[col]);
    changed++;
  });
  return changed;
}

/**
 * Rewrite the quantity columns in place with the scaled reading. Returns the
 * number of cells changed. Call only when `detectPeriodThousands` says so.
 */
export function applyPeriodThousands(
  rows: Record<string, unknown>[],
  quantityColumns: string[],
): number {
  let changed = 0;
  for (const r of rows) {
    for (const col of quantityColumns) {
      if (!(col in r)) continue;
      if (!isThousandsSuspect(r[col])) continue;
      r[col] = readQtyScaled(r[col]);
      changed++;
    }
  }
  return changed;
}

/** Plain-language lines for the upload result and the activity log. */
export function describeDetection(d: ThousandsDetection, changed: number): string[] {
  const lines: string[] = [];
  const n = (c: number) => `${c} value${c === 1 ? "" : "s"}`;

  if (d.applies && d.basis === "star-totals") {
    lines.push(
      `Thousands separator: this file writes 1,525 as "1.525" in its quantity columns. ` +
      `${changed} value${changed === 1 ? "" : "s"} rescaled — confirmed against the file's own ` +
      `"**" total lines (${d.reconciledScaled} of ${d.judged} agree scaled, ` +
      `${d.reconciledPlain} unscaled).`
    );
  } else if (d.applies && d.basis === "totals-exceed-parts") {
    lines.push(
      `Thousands separator: this file writes 1,525 as "1.525" in its quantity columns. ` +
      `${changed} value${changed === 1 ? "" : "s"} rescaled. There are no "**" total lines here, ` +
      `so each one was confirmed on its own: read as a decimal it would be a year-to-date or ` +
      `grand total SMALLER than a single month inside it — impossible. Every other quantity in ` +
      `the file is a whole number and not one reaches 1,000.`
    );
    if (d.unjudged > 0) {
      lines.push(
        `${n(d.unjudged)} elsewhere also contain a decimal point, but nothing in the file ` +
        `proves what they should be, so they were left exactly as they are.`
      );
    }
  } else if (d.unjudged > 0) {
    lines.push(
      `${n(d.unjudged)} look like a period-separated thousand (e.g. "1.525"), but nothing in ` +
      `this file can confirm it${d.shape.values > 0 && !d.shape.ok ? " — its quantities do not all read as whole numbers" : ""}, ` +
      `so they were loaded as-is. If sales look ~1000x too small, this is why.`
    );
  } else if (d.suspects > 0 && d.judged > 0 && !d.applies) {
    lines.push(
      `${n(d.suspects)} contain a decimal point. ` +
      `The file's "**" total lines confirm they are genuine decimals, not thousands — left as-is.`
    );
  }
  return lines;
}
