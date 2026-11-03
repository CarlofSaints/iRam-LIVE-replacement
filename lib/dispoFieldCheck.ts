/* Which DISPO fields the Month-End report reads that a channel's DISPO did not
   send. Massbuild sends STO and Buyer, Makro does not; a missing field must
   never fail the report, only be named, so the reader knows why a column is
   blank. Checked on the stored ledger: a column the DISPO lacks never lands on
   any row. Each entry is one field; alternatives are header names that mean the
   same thing (PR ST is stored as Status by older parsers). */
const REPORT_FIELDS: { label: string; keys: string[] }[] = [
  { label: "Article Desc", keys: ["Article Desc"] },
  { label: "PR ST (Status)", keys: ["Status", "PR ST"] },
  { label: "RP", keys: ["RP"] },
  { label: "SOH", keys: ["SOH"] },
  { label: "SOO", keys: ["SOO"] },
  { label: "SIT", keys: ["SIT"] },
  { label: "STO", keys: ["STO"] },
  { label: "R. Profile", keys: ["R. Profile"] },
  { label: "MAC", keys: ["MAC"] },
  { label: "Nett Cost", keys: ["Nett Cost"] },
  { label: "Incl SP", keys: ["Incl SP"] },
  { label: "Prom SP", keys: ["Prom SP"] },
  { label: "Stock Margin", keys: ["Stock Margin"] },
  { label: "Act DSC", keys: ["Act DSC"] },
  { label: "Last Sold", keys: ["Last Sold"] },
  { label: "Last Recv", keys: ["Last Recv"] },
  { label: "Buyer", keys: ["Buyer"] },
];

export function missingDispoFields(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  return REPORT_FIELDS
    .filter((f) => !rows.some((r) => f.keys.some((k) => k in r)))
    .map((f) => f.label);
}

/* One line per distinct gap, channels with the identical gap grouped (a Makro
   DISPO's split companions — Walmart, Food Store — would otherwise repeat it). */
export function missingFieldLines(ledgers: { channelName: string; rows: Record<string, unknown>[] }[]): string[] {
  const byGap = new Map<string, string[]>();
  for (const l of ledgers) {
    const gap = missingDispoFields(l.rows);
    if (gap.length === 0) continue;
    const key = gap.join(", ");
    const names = byGap.get(key) ?? [];
    if (!names.includes(l.channelName)) names.push(l.channelName);
    byGap.set(key, names);
  }
  return [...byGap].map(([gap, names]) => `${names.join(" / ")} DISPO does not include: ${gap}`);
}
