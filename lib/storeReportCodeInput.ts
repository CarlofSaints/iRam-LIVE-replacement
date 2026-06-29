/* ──────────────────────────────────────────────────────────────
   Shared "Site Code Check" input list.

   The pasted Perigee code+name list used by the Site Code Check tool is stored
   server-side (not just in one user's localStorage) so any admin / super-admin
   can pick up the same list and help with the linking work.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";

const KEY = "store-reports/code-input.json";

export interface CodeInput {
  text: string;
  updatedAt: string;
  updatedBy?: string;
}

export async function getCodeInput(): Promise<CodeInput> {
  return readJson<CodeInput>(KEY, { text: "", updatedAt: "" });
}

export async function setCodeInput(text: string, by?: string): Promise<CodeInput> {
  const entry: CodeInput = { text: String(text ?? ""), updatedAt: new Date().toISOString(), updatedBy: by };
  await writeJson(KEY, entry);
  return entry;
}
