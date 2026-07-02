/* ──────────────────────────────────────────────────────────────
   Shared "Site Code Check" input list.

   The pasted Perigee code+name list used by the Site Code Check tool is stored
   server-side (not just in one user's localStorage) so any admin / super-admin
   can pick up the same list and help with the linking work.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";
import { looseCode } from "./storeReportCodeMap";

const KEY = "store-reports/code-input.json";

export interface CodeInput {
  text: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface CodeEntry {
  code: string;
  name: string;
}

export async function getCodeInput(): Promise<CodeInput> {
  return readJson<CodeInput>(KEY, { text: "", updatedAt: "" });
}

export async function setCodeInput(text: string, by?: string): Promise<CodeInput> {
  const entry: CodeInput = { text: String(text ?? ""), updatedAt: new Date().toISOString(), updatedBy: by };
  await writeJson(KEY, entry);
  return entry;
}

// Parse the stored list (tab / comma / semicolon separated: code, then name).
function parseLines(text: string): CodeEntry[] {
  return String(text ?? "").split(/\r?\n/).map((line) => {
    const m = line.match(/^([^\t,;]+)[\t,;]+(.*)$/);
    if (m) return { code: m[1].trim(), name: m[2].trim() };
    return { code: line.trim(), name: "" };
  }).filter((e) => e.code);
}

function toText(entries: CodeEntry[]): string {
  return entries.map((e) => (e.name ? `${e.code}\t${e.name}` : e.code)).join("\n");
}

// ADD ONLY: merge new entries into the shared list, keeping every existing store
// (and its name) untouched. Codes already present are skipped, never overwritten.
// Returns which codes were added vs skipped so the UI can warn the pasting user.
export async function mergeCodeInput(
  entries: CodeEntry[],
  by?: string,
): Promise<{ input: CodeInput; added: string[]; skipped: string[] }> {
  const existing = parseLines((await getCodeInput()).text);
  const have = new Set(existing.map((e) => looseCode(e.code)));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    const code = String(e?.code ?? "").trim();
    if (!code) continue;
    if (have.has(looseCode(code))) { skipped.push(code); continue; }
    have.add(looseCode(code));
    existing.push({ code, name: String(e?.name ?? "").trim() });
    added.push(code);
  }
  const input = await setCodeInput(toText(existing), by);
  return { input, added, skipped };
}

// Explicit removal of specific codes from the shared list (Remove button).
export async function removeCodeInput(codes: string[], by?: string): Promise<CodeInput> {
  const drop = new Set(codes.map((c) => looseCode(c)));
  const kept = parseLines((await getCodeInput()).text).filter((e) => !drop.has(looseCode(e.code)));
  return setCodeInput(toText(kept), by);
}
