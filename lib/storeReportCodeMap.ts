/* ──────────────────────────────────────────────────────────────
   DISPO ↔ Perigee site-code map.

   Perigee check-ins arrive with a `storeCode` that should match the DISPO
   "Site" code. Case / spacing / dash differences are bridged automatically
   (loose match), but where the codes genuinely differ (and we can't change
   either side) a manual mapping links the Perigee code to the DISPO code so the
   trigger still knows which store's report to send.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";

const KEY = "store-reports/code-map.json";

export interface CodeMapping {
  perigeeCode: string;
  dispoCode: string;
  createdAt: string;
  createdBy?: string;
}

// Loose comparison: trim, lowercase, strip spaces / dashes / underscores. Used
// both for matching codes and for keying the map (so "S-117" links "S117" etc).
export function looseCode(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/[\s\-_]+/g, "");
}

export async function getCodeMap(): Promise<CodeMapping[]> {
  return readJson<CodeMapping[]>(KEY, []);
}

export async function setMapping(perigeeCode: string, dispoCode: string, by?: string): Promise<CodeMapping[]> {
  const map = await getCodeMap();
  const i = map.findIndex((m) => looseCode(m.perigeeCode) === looseCode(perigeeCode));
  const entry: CodeMapping = {
    perigeeCode: perigeeCode.trim(),
    dispoCode: dispoCode.trim(),
    createdAt: new Date().toISOString(),
    createdBy: by,
  };
  if (i >= 0) map[i] = entry; else map.push(entry);
  await writeJson(KEY, map);
  return map;
}

export async function removeMapping(perigeeCode: string): Promise<CodeMapping[]> {
  const map = (await getCodeMap()).filter((m) => looseCode(m.perigeeCode) !== looseCode(perigeeCode));
  await writeJson(KEY, map);
  return map;
}

// A resolver from a loaded map: Perigee code → DISPO code (or null if unmapped).
export function buildResolver(map: CodeMapping[]): (code: string) => string | null {
  const byPerigee = new Map(map.map((m) => [looseCode(m.perigeeCode), m.dispoCode]));
  return (code: string) => byPerigee.get(looseCode(code)) ?? null;
}

export async function resolveDispoCode(perigeeCode: string): Promise<string | null> {
  return buildResolver(await getCodeMap())(perigeeCode);
}
