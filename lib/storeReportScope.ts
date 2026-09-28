/* ──────────────────────────────────────────────────────────────
   Which clients a check-in's store report may contain.

   The poller emails whoever checked in, at the address on the Perigee visit.
   By default that report is CONSOLIDATED: every client opted in to store
   reports, which is right for iRam's own merchandisers. A customer's rep must
   only ever see their own client, so a user account can be marked "own
   clients only" with the clients they may see. The tick is always a manual
   choice, for a Rep as much as anyone (Carl, 28 Sep): the role never implies it.

   Rules, in order:
     • no account for this email          → all (today's behaviour, untouched)
     • account not limited                 → all
     • limited, but deactivated            → BLOCKED (a switched-off customer
                                             rep must not fall back to "all")
     • limited, no clients ticked          → BLOCKED
     • limited, clients ticked             → those clients only
     • several accounts share the email and
       ANY is limited                      → BLOCKED unless they agree exactly

   BLOCKED means send nothing. It never means "fall back to everything".
   ────────────────────────────────────────────────────────────── */

import type { User } from "./types";

export type StoreReportScope =
  | { kind: "all" }
  | { kind: "clients"; clientIds: string[] }
  | { kind: "blocked"; reason: string };

/** Emails compare after trimming, lowercasing and removing invisible
 *  characters. Perigee and our Users screen are typed by different people. */
export function normReportEmail(v: unknown): string {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase();
}

export function isLimitedToOwnClients(u: Pick<User, "storeReportOwnClientsOnly">): boolean {
  return u.storeReportOwnClientsOnly === true;
}

export type ScopeIndex = Map<string, User[]>;

export function buildScopeIndex(users: User[]): ScopeIndex {
  const index: ScopeIndex = new Map();
  for (const u of users) {
    const key = normReportEmail(u.email);
    if (!key) continue;
    const list = index.get(key);
    if (list) list.push(u);
    else index.set(key, [u]);
  }
  return index;
}

function scopeForUser(u: User): StoreReportScope {
  if (!isLimitedToOwnClients(u)) return { kind: "all" };
  if (!u.active) return { kind: "blocked", reason: `${u.email} is limited to their own clients but the account is deactivated` };
  const ids = [...new Set((u.storeReportClientIds ?? []).filter(Boolean))];
  if (!ids.length) return { kind: "blocked", reason: `${u.email} is limited to their own clients but none are ticked` };
  return { kind: "clients", clientIds: ids.sort() };
}

export function scopeForEmail(index: ScopeIndex, email: string): StoreReportScope {
  const matches = index.get(normReportEmail(email)) ?? [];
  if (!matches.length) return { kind: "all" };

  const scopes = matches.map(scopeForUser);
  if (scopes.length === 1) return scopes[0];

  // Several accounts on one address. Unlimited only if every one is unlimited.
  if (scopes.every((s) => s.kind === "all")) return { kind: "all" };
  const blocked = scopes.find((s) => s.kind === "blocked");
  if (blocked) return blocked;
  const lists = scopes.map((s) => (s.kind === "clients" ? s.clientIds.join(",") : "*"));
  if (lists.every((l) => l === lists[0])) return scopes[0];
  return { kind: "blocked", reason: `${matches.length} user accounts share ${normReportEmail(email)} with different client lists` };
}
