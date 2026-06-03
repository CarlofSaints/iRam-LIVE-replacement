import type { PasswordResetToken } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const TOKENS_KEY = "password-reset-tokens.json";

export async function createResetToken(email: string): Promise<string> {
  const tokens = await readJson<PasswordResetToken[]>(TOKENS_KEY, []);
  const token: PasswordResetToken = {
    token: uuid(),
    email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    used: false,
  };
  const filtered = tokens.filter((t) => t.email !== email.toLowerCase());
  filtered.push(token);
  const now = new Date().toISOString();
  const cleaned = filtered.filter((t) => t.expiresAt > now || !t.used);
  await writeJson(TOKENS_KEY, cleaned);
  return token.token;
}

export async function validateResetToken(
  token: string
): Promise<PasswordResetToken | null> {
  const tokens = await readJson<PasswordResetToken[]>(TOKENS_KEY, []);
  const entry = tokens.find((t) => t.token === token);
  if (!entry) return null;
  if (entry.used) return null;
  if (new Date(entry.expiresAt) < new Date()) return null;
  return entry;
}

export async function markTokenUsed(token: string): Promise<void> {
  const tokens = await readJson<PasswordResetToken[]>(TOKENS_KEY, []);
  const entry = tokens.find((t) => t.token === token);
  if (entry) {
    entry.used = true;
    await writeJson(TOKENS_KEY, tokens);
  }
}
