/* ──────────────────────────────────────────────────────────────
   SQL Direct (pilot) — what each manually-loaded artefact maps to in SQL.

   Today every one of these arrives as a spreadsheet someone uploads. All four
   already exist as stored procedures behind the shared Railway SQL proxy (the
   same one the store-report trigger uses), so the pilot needs no new proxy
   queries — it only needs to prove the data matches before anything switches.

   NOTHING HERE WRITES. Every source is read-only, and the pilot never touches
   the sales ledger, the store master, control files or the upload index. The
   existing manual path keeps running untouched until the comparison says it
   can stop.
   ────────────────────────────────────────────────────────────── */

export type SqlSourceKind = "stores" | "products" | "links" | "sales";

export interface SqlSource {
  /** Stable id used by the API + UI. */
  id: string;
  /** What this replaces in the current manual flow. */
  replaces: string;
  label: string;
  kind: SqlSourceKind;
  /** Named query in the proxy registry (proxy refuses raw SQL). */
  query: string;
  /** Stored procedure behind it, for the record. */
  proc: string;
  /** Main channel this source is scoped to, when it is channel-specific. */
  channel?: "MAKRO" | "MASSBUILD" | "GAME";
  /**
   * Does the stored procedure take a client name?
   *
   * Mark's three iRam Live procs do NOT — they return everything currently
   * flagged as IRAM Live and the caller narrows on the Client / Channel
   * columns in the result. That makes `sqlClientName` load-bearing: it is the
   * only thing that ties a row back to an iRam client, where a parameter
   * would have done it. Defaults to true for the sales procs, which do.
   */
  clientScoped?: boolean;
  notes?: string;
}

/** A source takes a client name unless it says otherwise. */
export function takesClientName(s: SqlSource): boolean {
  return s.clientScoped !== false;
}

/* The three main channels iRam LIVE actually loads DISPOs for. Each has its
   own sales SP; there is no single "all channels" call, so a full picture
   means one call per channel and merging — exactly what the manual flow does
   with one DISPO per channel today. */
export const SQL_SOURCES: SqlSource[] = [
  {
    id: "stores",
    replaces: "Store control file (Control Centre → Store Files)",
    label: "Retail sites / store master",
    kind: "stores",
    query: "iram_live_retail_sites",
    proc: "GetIRAMLiveRetailSites",
    clientScoped: false,
    notes:
      "tblSites filtered to the distinct channels on the IRAM Live client list. Optional @CountryList " +
      "(comma-separated) narrows by country; omitted here, which is Mark's guidance for all countries. " +
      "Returning every channel rather than one client SUITS iRam, whose store master is global and merged.",
  },
  {
    id: "products",
    replaces: "PMF (client control file)",
    label: "Product master (PMF)",
    kind: "products",
    query: "iram_live_products",
    proc: "GetIRAMLiveProducts",
    clientScoped: false,
    notes:
      "tblProducts filtered to the Client/Product ID pairs found in the product links. Narrow to one " +
      "iRam client on the Client column of the result — via sqlClientName, since there is no parameter.",
  },
  {
    id: "links",
    replaces: "LINKS (client control file)",
    label: "Product links (Article → Client Product ID)",
    kind: "links",
    query: "iram_live_product_links",
    proc: "GetIRAMLiveProductLinks",
    clientScoped: false,
    notes:
      "Client, Channel, Channel Article, Article, Product ID, Channel Product Status, Channel Product RSP.",
  },
  {
    id: "sales_makro",
    replaces: "DISPO upload — MAKRO",
    label: "Sales / stock facts — MAKRO",
    kind: "sales",
    query: "sales_makro",
    proc: "GetDataForCustomDev_MAKRO_Sales",
    channel: "MAKRO",
    notes: "Accepts an optional yearMonth (YYYY-MM) to roll back to a month end.",
  },
  {
    id: "sales_massbuild",
    replaces: "DISPO upload — MASSBUILD",
    label: "Sales / stock facts — MASSBUILD",
    kind: "sales",
    query: "sales_massbuild",
    proc: "GetDataForCustomDev_MASSBUILD_Sales",
    channel: "MASSBUILD",
    notes: "Accepts an optional yearMonth (YYYY-MM) to roll back to a month end.",
  },
  {
    id: "sales_game",
    replaces: "DISPO upload — GAME",
    label: "Sales / stock facts — GAME",
    kind: "sales",
    query: "sales_game",
    proc: "GetDataForCustomDev_GAME_Sales",
    channel: "GAME",
    notes: "Accepts an optional yearMonth (YYYY-MM) to roll back to a month end.",
  },
];

export function getSqlSource(id: string): SqlSource | undefined {
  return SQL_SOURCES.find((s) => s.id === id);
}

/**
 * Column names present across a result set.
 *
 * Sampling only the first row is not enough: these SPs return sparse rows, so
 * a column that is null in row 1 would look like it does not exist at all.
 */
export function collectColumns(rows: Record<string, unknown>[], sampleSize = 200): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, sampleSize)) {
    for (const k of Object.keys(row)) seen.add(k);
  }
  return Array.from(seen);
}

/**
 * How much of a column is actually populated. A column that exists but is
 * empty everywhere is the difference between "SQL has this data" and "SQL has
 * a column where this data should be", and only the second one blocks a
 * switchover.
 */
export function columnFill(
  rows: Record<string, unknown>[],
  columns: string[],
  sampleSize = 500,
): { column: string; filledPct: number; sample: string }[] {
  const sample = rows.slice(0, sampleSize);
  if (sample.length === 0) return columns.map((c) => ({ column: c, filledPct: 0, sample: "" }));
  return columns.map((column) => {
    let filled = 0;
    let example = "";
    for (const row of sample) {
      const v = row[column];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        filled++;
        if (!example) example = String(v).slice(0, 40);
      }
    }
    return {
      column,
      filledPct: Math.round((filled / sample.length) * 100),
      sample: example,
    };
  });
}
