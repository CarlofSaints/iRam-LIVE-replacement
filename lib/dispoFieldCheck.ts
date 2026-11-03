/* Which DISPO fields the Month-End report reads that a channel's DISPO did not
   send. Massbuild sends STO and Buyer, Makro does not; a missing field must
   never fail the report, only be named, so the reader knows why a column is
   blank. Checked on the stored ledger: a column the DISPO lacks never lands on
   any row. `keys` are header names that mean the same thing (PR ST is stored
   as Status by older parsers); `effect` is what the gap does to this report. */
const REPORT_FIELDS: { label: string; keys: string[]; effect: string }[] = [
  { label: "Article Desc", keys: ["Article Desc"], effect: "Description is blank on most detail sheets." },
  { label: "PR ST (Status)", keys: ["Status", "PR ST"], effect: "Every line reads UNCLASSIFIED on the Status sheets, and Open to Order suggests nothing." },
  { label: "RP", keys: ["RP"], effect: "RP column is blank on the detail sheets." },
  { label: "SOH", keys: ["SOH"], effect: "Stock on hand reads 0: OOS, Phantom and Margin are not reliable." },
  { label: "SOO", keys: ["SOO"], effect: "Stock on order reads 0 in OOS and Open to Order." },
  { label: "SIT", keys: ["SIT"], effect: "Stock in transit reads 0 in OOS and Open to Order." },
  { label: "STO", keys: ["STO"], effect: "STO column is blank on the detail sheets." },
  { label: "R. Profile", keys: ["R. Profile"], effect: "Open to Order units use the Order Unit instead (else 2 units)." },
  { label: "MAC", keys: ["MAC"], effect: "Margin cannot be worked out." },
  { label: "Nett Cost", keys: ["Nett Cost"], effect: "Open to Order value and Margin read 0." },
  { label: "Incl SP", keys: ["Incl SP"], effect: "Sales values read 0 unless a promo price is set." },
  { label: "Prom SP", keys: ["Prom SP"], effect: "Sales values use the normal selling price only." },
  { label: "Stock Margin", keys: ["Stock Margin"], effect: "STK Margin is blank." },
  { label: "Act DSC", keys: ["Act DSC"], effect: "DSC sheets have nothing to show." },
  { label: "Last Sold", keys: ["Last Sold"], effect: "Phantom treats every line as not sold recently." },
  { label: "Last Recv", keys: ["Last Recv"], effect: "Phantom treats every line as not received recently." },
  { label: "Buyer", keys: ["Buyer"], effect: "Not used in this report's numbers; listed so you know it is absent." },
];

export function missingDispoFields(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  return REPORT_FIELDS
    .filter((f) => !rows.some((r) => f.keys.some((k) => k in r)))
    .map((f) => f.label);
}

export const fieldEffect = (label: string) => REPORT_FIELDS.find((f) => f.label === label)?.effect ?? "";

export interface MissingFieldGroup { channels: string[]; fields: string[] }

/* Channels with the identical gap grouped (a Makro DISPO's split companions,
   Walmart and Food Store, would otherwise repeat it). */
export function missingFieldGroups(ledgers: { channelName: string; rows: Record<string, unknown>[] }[]): MissingFieldGroup[] {
  const byGap = new Map<string, MissingFieldGroup>();
  for (const l of ledgers) {
    const fields = missingDispoFields(l.rows);
    if (fields.length === 0) continue;
    const g = byGap.get(fields.join("|")) ?? { channels: [], fields };
    if (!g.channels.includes(l.channelName)) g.channels.push(l.channelName);
    byGap.set(fields.join("|"), g);
  }
  return [...byGap.values()];
}

export const missingFieldLine = (g: MissingFieldGroup) =>
  `${g.channels.join(" / ")} DISPO does not include: ${g.fields.join(", ")}`;
