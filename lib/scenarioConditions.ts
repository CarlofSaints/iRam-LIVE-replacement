/* Pure helpers for status-scenario conditions — no blob/server imports, so
   the Status Reference page (a client component) can use them too. Same
   reasoning as lib/dataCoverage.ts. */

import type { StatusScenarioConditions } from "./types";

/**
 * The PMF statuses a scenario matches, as a normalised list.
 *
 * A scenario can constrain the client status with a LIST (`clientStatuses`),
 * but scenarios saved before multi-select carry a single `clientStatus`
 * string. This is the ONLY place that difference is resolved — read through
 * here rather than touching either field directly, so the two can never drift
 * into two sources of truth.
 *
 * An empty list means "any status" (unconstrained).
 */
export function scenarioClientStatuses(conditions: StatusScenarioConditions): string[] {
  const many = conditions.clientStatuses;
  if (Array.isArray(many) && many.length > 0) {
    return many.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  }
  const one = conditions.clientStatus;
  if (typeof one === "string" && one.trim()) return [one.trim().toUpperCase()];
  return [];
}

/**
 * Normalise conditions on the way IN. Statuses are stored trimmed + uppercased
 * so matching never depends on how they were typed, and the legacy single
 * field is dropped once a scenario is saved — leaving both populated would be
 * exactly the mirror-vs-source-of-truth trap.
 */
export function normaliseConditions(
  conditions: StatusScenarioConditions,
): StatusScenarioConditions {
  const statuses = scenarioClientStatuses(conditions);
  const out: StatusScenarioConditions = {};
  if (statuses.length > 0) out.clientStatuses = Array.from(new Set(statuses));
  if (conditions.rangingStatus !== undefined) out.rangingStatus = conditions.rangingStatus;
  return out;
}

/** Compact label for a set of PMF statuses — shared by the MultiSelect button
 *  and the scenarios table so they always read the same. */
export function statusSummary(statuses: string[]): string {
  if (statuses.length === 0) return "Any";
  if (statuses.length <= 2) return statuses.join(", ");
  return `${statuses.length} statuses`;
}
