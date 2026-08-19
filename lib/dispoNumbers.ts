/* Quantity columns in some SAP DISPO exports use a PERIOD as the thousands
   separator and drop trailing zeros, so 1,500 is written `1.5` and 1,525 is
   written `1.525`. Read naively those become one-point-five and one-point-five-
   two-five — a thousandfold understatement that lands straight in the ledger,
   in Vital Signs and in Month-End.

   Found 19 Aug 2026 on VERIGREEN 9677 / MAKRO / Aug-2026 Wk2: 91 cells, 74 of
   them in `Curr Y/S`, which read 41,404 units against a true 135,830.

   WE DO NOT GUESS. The file carries its own oracle: Makro-style DISPOs list an
   Article×Site once per UOM and then a `**` line holding the grand total in
   BASE units — Σ(units × Compo) across the UOM lines. So for any file with `**`
   lines we can simply try both readings and keep the one the file's own
   arithmetic agrees with. On the VERIGREEN file the scaled reading reconciles
   194 of 194 keys and the naive reading only 162.

   A file with suspect cells but no `**` line to judge them by is left ALONE and
   reported, because scaling a genuine decimal by 1000 is far worse than leaving
   a number small — see `describeDetection`. */

/** Columns whose values are quantities, not prices. Date columns are added per
    file (they are dynamic); this is the fixed one that sits beside them. */
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

export interface ThousandsDetection {
  /** Rewrite the quantity columns with the scaled reading? */
  applies: boolean;
  /** Cells matching the suspect shape, across the quantity columns. */
  suspects: number;
  /** (Article|Site, column) pairs containing a suspect that the `**` line could
      be used to judge. */
  judged: number;
  /** …of those, how many reconcile under each reading. */
  reconciledPlain: number;
  reconciledScaled: number;
  /** Suspect cells sitting in a group with no `**` line — unjudgeable, left as
      they are, and worth telling the user about. */
  unjudged: number;
}

const uomOf = (r: Record<string, unknown>) => String(r["UOM"] ?? "").trim();
const isTotalRow = (r: Record<string, unknown>) => uomOf(r) === "**";

function groupByArticleSite(
  rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>[]> {
  const g = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const a = String(r["Article"] ?? "").trim().toLowerCase();
    const s = String(r["Site"] ?? "").trim().toLowerCase();
    if (!a || !s) continue;
    const k = `${a}|${s}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(r);
  }
  return g;
}

/**
 * Decide, from the file's own `**` total lines, whether the quantity columns
 * encode thousands with a period.
 */
export function detectPeriodThousands(
  rows: Record<string, unknown>[],
  quantityColumns: string[],
): ThousandsDetection {
  const out: ThousandsDetection = {
    applies: false, suspects: 0, judged: 0,
    reconciledPlain: 0, reconciledScaled: 0, unjudged: 0,
  };
  if (quantityColumns.length === 0) return out;

  const groups = groupByArticleSite(rows);

  for (const members of groups.values()) {
    const total = members.find(isTotalRow);
    const parts = members.filter((r) => !isTotalRow(r));

    for (const col of quantityColumns) {
      const cells = members.map((r) => r[col]);
      const suspectsHere = cells.filter(isThousandsSuspect).length;
      if (suspectsHere === 0) continue;
      out.suspects += suspectsHere;

      if (!total || parts.length === 0) { out.unjudged += suspectsHere; continue; }
      out.judged++;

      // The `**` line equals Σ(units × Compo) over the UOM lines. Compo is a
      // pack size, never thousands-encoded, so it is read plainly either way.
      const compo = (r: Record<string, unknown>) => {
        const c = readQty(r["Compo"]);
        return c > 0 ? c : 1;
      };
      const plainSum = parts.reduce((a, r) => a + readQty(r[col]) * compo(r), 0);
      const scaledSum = parts.reduce((a, r) => a + readQtyScaled(r[col]) * compo(r), 0);
      if (Math.abs(readQty(total[col]) - plainSum) < 0.01) out.reconciledPlain++;
      if (Math.abs(readQtyScaled(total[col]) - scaledSum) < 0.01) out.reconciledScaled++;
    }
  }

  // Only act on a clear, unanimous win. Every judgeable case must agree with the
  // scaled reading, and the plain reading must actually be worse — otherwise
  // there is nothing to fix.
  out.applies =
    out.judged > 0 &&
    out.reconciledScaled === out.judged &&
    out.reconciledScaled > out.reconciledPlain;

  return out;
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
  if (d.applies) {
    lines.push(
      `Thousands separator: this file writes 1,525 as "1.525" in its quantity columns. ` +
      `${changed} value${changed === 1 ? "" : "s"} rescaled — confirmed against the file's own ` +
      `"**" total lines (${d.reconciledScaled} of ${d.judged} agree scaled, ` +
      `${d.reconciledPlain} unscaled).`
    );
  } else if (d.unjudged > 0) {
    lines.push(
      `${d.unjudged} quantity value${d.unjudged === 1 ? "" : "s"} look like a period-separated ` +
      `thousand (e.g. "1.525"), but this file has no "**" total lines to confirm it against, ` +
      `so they were loaded as-is. If sales look ~1000x too small, this is why.`
    );
  } else if (d.suspects > 0 && d.judged > 0 && !d.applies) {
    lines.push(
      `${d.suspects} quantity value${d.suspects === 1 ? "" : "s"} contain a decimal point. ` +
      `The file's "**" total lines confirm they are genuine decimals, not thousands — left as-is.`
    );
  }
  return lines;
}
