/* ──────────────────────────────────────────────────────────────
   "Ignore for now" list for the Site Code Check.

   Perigee stores we can't map yet (e.g. a channel whose DISPO data isn't
   loaded — Game) are parked here so they drop out of the main mapping grid
   without being deleted from the pasted list. Stored server-side (shared across
   admins), keyed loosely so "S-55" and "S55" are the same store.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";
import { looseCode } from "./storeReportCodeMap";

const KEY = "store-reports/code-ignore.json";

export interface IgnoredCode {
  code: string;
  ignoredAt: string;
  ignoredBy?: string;
}

export async function getIgnored(): Promise<IgnoredCode[]> {
  return readJson<IgnoredCode[]>(KEY, []);
}

export async function addIgnored(codes: string[], by?: string): Promise<IgnoredCode[]> {
  const list = await getIgnored();
  const have = new Set(list.map((i) => looseCode(i.code)));
  const now = new Date().toISOString();
  for (const c of codes) {
    const code = String(c ?? "").trim();
    if (!code || have.has(looseCode(code))) continue;
    have.add(looseCode(code));
    list.push({ code, ignoredAt: now, ignoredBy: by });
  }
  await writeJson(KEY, list);
  return list;
}

export async function removeIgnored(codes: string[]): Promise<IgnoredCode[]> {
  const drop = new Set(codes.map((c) => looseCode(c)));
  const list = (await getIgnored()).filter((i) => !drop.has(looseCode(i.code)));
  await writeJson(KEY, list);
  return list;
}
