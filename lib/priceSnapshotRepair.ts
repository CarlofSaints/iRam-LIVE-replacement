/* Repair the per-year price snapshots that hold PACK prices instead of unit prices.

   THE DAMAGE. A Makro-style DISPO lists the same Article×Site once per UOM —
   EA, CS, PAL, LAY, `**`. Sales and stock sit only on the selling-unit (EA) row;
   the pack rows carry zero units but REAL pack money:

       uom=EA   SOH=395  Incl SP=48.95     Nett Cost=28.81
       uom=CS   SOH=0    Incl SP=1194.95   Nett Cost=720.25     ← case of 25
       uom=PAL  SOH=0    Incl SP=null      Nett Cost=25929.00   ← pallet of 900

   Before `8f6014d` (30 Jun 2026) `mergeDispo` folded all of those onto one
   `Article|Site` key, last non-empty value winning — so the CASE price stuck.
   `mergeDispo` also snapshots the row's prices per calendar year
   (`_inclSP_2025`, `_promSP_2025`, `_nettCost_2025`) so that LY value uses LY
   money. Those snapshots therefore captured pack prices.

   Measured on VERIGREEN's Aug-2026 Wk2 report: same-month-LY value read
   R13,879,309.61 against a true R775,072 ex-VAT — R825.81 for a refuse bag.
   Emulating the old merge over the raw DISPO reproduces R19.34M, and 140 of 345
   ledger rows still carry a pack-level Nett Cost (7.5x the correct total).

   WHY IT CANNOT SELF-HEAL. The live `Incl SP` / `Nett Cost` columns are
   snapshots in the lib/dispoSnapshot.ts sense and are rewritten by the next
   DISPO load. `_inclSP_2025` is not: mergeDispo only writes `_inclSP_<year>`
   when <year> is the newest month in the file being loaded, so nothing short of
   re-uploading the 2025 DISPOs would touch it — and per the data-coverage work
   some 2025 months exist in no file at all.

   THE REPAIR (Carl's call, 17 Aug 2026). DELETE the poisoned snapshot rather
   than try to reconstruct a unit price from it. `priceForYear()` in
   lib/monthEndReport.ts already falls back to the row's current effective price
   when a year snapshot is absent, so LY value becomes LY units × today's price:
   wrong by inflation (~5-10%) instead of by a factor of 25. Dividing the pack
   price down would need the pack ratio inferred per row, and a wrong inference
   is silent — the same trap as [[enumerate-values-before-a-string-rule]].

   All of this is pure so scripts/test-price-snapshot-repair.ts can pin it. */

/* Pack multiples in the real files are 12, 25, 225 (layer) and 900 (pallet).
   Year-on-year price movement is a few percent; even a repricing is well under
   2x. 3 leaves a wide corridor between "the market moved" and "this is a case".
   Deliberately not tighter: a false positive DELETES real history. */
export const PACK_PRICE_RATIO = 3;

/* The three per-year snapshot families mergeDispo writes, and the live column
   each one should be in the same order of magnitude as. */
const SNAPSHOT_FAMILIES = [
  { prefix: "_inclSP_", live: "Incl SP" },
  { prefix: "_promSP_", live: "Prom SP" },
  { prefix: "_nettCost_", live: "Nett Cost" },
] as const;

/* `Prom SP` is 0 whenever there is no promotion, which is most rows. A zero
   live value tells us nothing about scale, so those snapshots are compared
   against `Incl SP` instead — a promo price is never an order of magnitude
   away from the shelf price. */
const PROM_FALLBACK_LIVE = "Incl SP";

export type SnapshotVerdict =
  | "ok"           // snapshot is in line with the live price
  | "poisoned"     // snapshot is a pack price — delete it
  | "live-suspect" // snapshot looks right and the LIVE price is the pack one
  | "unknown";     // no usable live price to compare against

export interface FieldFinding {
  field: string;        // e.g. "_inclSP_2025"
  year: number;
  snapshot: number;
  live: number;
  ratio: number;
  verdict: SnapshotVerdict;
}

export interface RowRepair {
  removed: string[];       // snapshot fields deleted from the row
  findings: FieldFinding[];
  liveSuspect: boolean;    // the row's CURRENT price looks pack-level
}

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(String(v).replace(/[, ]/g, "").replace(/^R/i, "").trim());
  return isNaN(n) ? NaN : n;
};

/* Classify one snapshot against the live column it shadows.

   Direction matters and is not symmetric:
   - snapshot >> live  → the snapshot is the pack price. Delete it.
   - snapshot << live  → the snapshot is fine and the LIVE column is the pack
     price (55 of 345 VERIGREEN rows). Deleting here would replace good history
     with a bad current price and make the report WORSE, so we keep it and
     report the row instead — the live column heals on the next DISPO load. */
export function classifySnapshot(snapshot: unknown, live: unknown): { verdict: SnapshotVerdict; ratio: number } {
  const s = num(snapshot);
  const l = num(live);
  if (!isFinite(s) || s <= 0) return { verdict: "ok", ratio: NaN };       // nothing stored, nothing to fix
  if (!isFinite(l) || l <= 0) return { verdict: "unknown", ratio: NaN };  // can't judge without a reference
  const ratio = s / l;
  if (ratio >= PACK_PRICE_RATIO) return { verdict: "poisoned", ratio };
  if (ratio <= 1 / PACK_PRICE_RATIO) return { verdict: "live-suspect", ratio };
  return { verdict: "ok", ratio };
}

/* Inspect (and optionally repair) one ledger row in place.

   `apply: false` is a true dry run — the row is not touched, so the same code
   path produces the preview and does the work and the two cannot drift. */
export function repairRow(
  row: Record<string, unknown>,
  opts: { apply: boolean },
): RowRepair {
  const removed: string[] = [];
  const findings: FieldFinding[] = [];
  let liveSuspect = false;

  for (const key of Object.keys(row)) {
    const family = SNAPSHOT_FAMILIES.find((f) => key.startsWith(f.prefix));
    if (!family) continue;
    const year = Number(key.slice(family.prefix.length));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) continue;

    let live = row[family.live];
    if (family.prefix === "_promSP_" && !(num(live) > 0)) live = row[PROM_FALLBACK_LIVE];

    const { verdict, ratio } = classifySnapshot(row[key], live);
    if (verdict === "ok") continue;

    findings.push({ field: key, year, snapshot: num(row[key]), live: num(live), ratio, verdict });
    if (verdict === "live-suspect") liveSuspect = true;
    if (verdict === "poisoned") {
      removed.push(key);
      if (opts.apply) delete row[key];
    }
  }

  return { removed, findings, liveSuspect };
}

export interface LedgerRepairSummary {
  rows: number;
  rowsRepaired: number;       // rows that lost at least one snapshot
  fieldsRemoved: number;
  byField: Record<string, number>;   // "_inclSP_2025" → how many rows
  liveSuspectRows: number;    // rows whose CURRENT price looks pack-level
  unknownRows: number;        // rows with a snapshot but no live price to judge it
  samples: FieldFinding[];    // first few, for the preview
}

const SAMPLE_LIMIT = 10;

/* Sweep a whole ledger. Mutates `rows` only when `apply` is true. */
export function repairLedger(
  rows: Record<string, unknown>[],
  opts: { apply: boolean },
): LedgerRepairSummary {
  const summary: LedgerRepairSummary = {
    rows: rows.length,
    rowsRepaired: 0,
    fieldsRemoved: 0,
    byField: {},
    liveSuspectRows: 0,
    unknownRows: 0,
    samples: [],
  };

  for (const row of rows) {
    const r = repairRow(row, opts);
    if (r.removed.length > 0) {
      summary.rowsRepaired++;
      summary.fieldsRemoved += r.removed.length;
      for (const f of r.removed) summary.byField[f] = (summary.byField[f] ?? 0) + 1;
    }
    if (r.liveSuspect) summary.liveSuspectRows++;
    if (r.findings.some((f) => f.verdict === "unknown")) summary.unknownRows++;
    for (const f of r.findings) {
      if (summary.samples.length < SAMPLE_LIMIT && f.verdict !== "unknown") summary.samples.push(f);
    }
  }

  return summary;
}
