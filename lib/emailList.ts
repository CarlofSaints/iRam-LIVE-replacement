/* Parse a hand-typed list of email addresses.

   Used by the public phantom-export endpoint, where a rep types who the count
   sheet should go to. Accepts commas AND semicolons: anyone who lives in
   Outlook separates with semicolons, and rejecting that would look like a bug
   in a perfectly good list. */

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export type EmailListResult =
  | { ok: true; list: string[] }
  | { ok: false; error: string };

export function parseEmailList(raw: string, max: number): EmailListResult {
  const parts = raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  const bad = parts.filter((p) => !isEmail(p));
  if (bad.length) {
    return {
      ok: false,
      error: bad.length === 1
        ? `"${bad[0]}" doesn't look like an email address.`
        : `These don't look like email addresses: ${bad.join(", ")}`,
    };
  }

  // Callers on PUBLIC endpoints must cap this — an uncapped recipient list is a
  // usable way to send mail to anyone via our domain.
  if (parts.length > max) {
    return { ok: false, error: `That's ${parts.length} addresses — please send to at most ${max} at a time.` };
  }

  // De-duplicate case-insensitively so typing the same address twice doesn't
  // send two copies, while keeping the order the rep typed.
  const seen = new Set<string>();
  const list: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(key);
  }
  return { ok: true, list };
}
