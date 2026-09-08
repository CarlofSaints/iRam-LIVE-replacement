/* ──────────────────────────────────────────────────────────────
   The client names iRam LIVE is allowed to use.

   They come from SQL Server (`EXEC [GetIRAMLiveClientNames]` on ClientMaster,
   via the named-query registry on the shared Railway proxy - the proxy
   refuses raw SQL by design). Nobody types a client name into this app any
   more: they pick one off this list, and if the client they want is not on it
   the answer is to get it added on the SQL side, not to invent a spelling
   here.

   Why: SQL keys every stored procedure on a client NAME string, and iRam used
   full legal names where SQL uses short trading ones - "BISCO" vs "BISCO PLUS
   (PTY) LTD". Only 1 of 30 iRam clients matched by exact name, and a wrong
   name is indistinguishable from "SQL has no data for this client". Picking
   from the source list is what stops that gap from reopening.

   READ-ONLY. This calls one parameterless stored procedure and returns
   strings.
   ────────────────────────────────────────────────────────────── */

import { sqlQuery, isProxyConfigured } from "./sqlProxy";

export const IRAM_CLIENT_NAMES_QUERY = "iram_live_client_names";

export interface SqlClientNameList {
  configured: boolean;
  names: string[];
  /** Which column the names were read out of, and everything the SP returned.
      Kept in the response because "no names" and "names under a column we did
      not expect" look identical from an empty list. */
  nameColumn: string | null;
  columns: string[];
  rowCount: number;
  error: string | null;
}

/* Names the column most likely to hold the client name. Exact matches first,
   because a SP that returns both "Client" and "ClientDescription" must not be
   read off whichever key happens to come first. */
const EXACT = ["client", "clientname", "client name", "name", "clientdescription"];

export function collectColumns(rows: Record<string, unknown>[]): string[] {
  /* Across rows, not row 1: these SPs return sparse rows, so a column can be
     absent from the first one. */
  const seen = new Set<string>();
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

export function pickNameColumn(rows: Record<string, unknown>[]): string | null {
  const columns = collectColumns(rows);
  if (columns.length === 0) return null;

  const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, "");
  for (const want of EXACT.map(norm)) {
    const hit = columns.find((c) => norm(c) === want);
    if (hit) return hit;
  }
  // Nothing recognisable: the left-most column that actually holds text.
  const textual = columns.find((c) =>
    rows.some((r) => typeof r[c] === "string" && String(r[c]).trim() !== ""),
  );
  return textual ?? columns[0];
}

export async function getIramLiveClientNames(): Promise<SqlClientNameList> {
  if (!isProxyConfigured()) {
    return {
      configured: false, names: [], nameColumn: null, columns: [], rowCount: 0,
      error:
        "SQL_PROXY_URL and/or SQL_PROXY_API_KEY are not set on this deployment, " +
        "so the client list cannot be read from SQL Server.",
    };
  }

  try {
    const res = await sqlQuery<Record<string, unknown>>(IRAM_CLIENT_NAMES_QUERY);
    const rows = res.data ?? [];
    const nameColumn = pickNameColumn(rows);
    const names = nameColumn
      ? [...new Set(rows.map((r) => String(r[nameColumn] ?? "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
      : [];
    return {
      configured: true, names, nameColumn,
      columns: collectColumns(rows), rowCount: rows.length, error: null,
    };
  } catch (e) {
    return {
      configured: true, names: [], nameColumn: null, columns: [], rowCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Case- and spacing-insensitive, so "Bisco  Plus" cannot slip past as new. */
export function normaliseClientName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isKnownClientName(name: string, names: string[]): boolean {
  const want = normaliseClientName(name);
  return names.some((n) => normaliseClientName(n) === want);
}

/** The list's own spelling of a name, so what gets stored is what SQL holds. */
export function canonicalClientName(name: string, names: string[]): string | null {
  const want = normaliseClientName(name);
  return names.find((n) => normaliseClientName(n) === want) ?? null;
}
