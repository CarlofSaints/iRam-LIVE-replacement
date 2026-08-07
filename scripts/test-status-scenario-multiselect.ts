/* Status scenarios: multi-select PMF status.

   A scenario's client-status condition used to be a single string. It can now
   be a LIST, matching if the row's PMF status is any of them. Two things have
   to hold and neither is visible from the UI:

     1. Scenarios saved BEFORE this change still carry `clientStatus` (single).
        They live in a blob that is never migrated, so they must keep matching
        exactly as they did.
     2. Listing several statuses makes ties far more likely — "ACTIVE" and
        "ACTIVE or DISCONTINUED" both constrain one condition, so for an ACTIVE
        row the old code would have picked whichever sat earlier in the stored
        array, i.e. insertion order. Narrower now wins.

   Run: npx tsx scripts/test-status-scenario-multiselect.ts */

import { evaluateScenarios } from "../lib/statusScenarioData";
import { scenarioClientStatuses, normaliseConditions, statusSummary } from "../lib/scenarioConditions";
import type { StatusScenario, StatusScenarioConditions } from "../lib/types";

let failures = 0;
function assert(label: string, cond: boolean, note = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${note ? `  — ${note}` : ""}`);
}

let seq = 0;
function scenario(
  conditions: StatusScenarioConditions,
  classification: "POSITIVE" | "NEGATIVE",
): StatusScenario {
  seq++;
  return {
    id: `s${seq}`, statusCode: "Z4", channelId: "massbuild",
    conditions, classification,
    createdAt: "", updatedAt: "",
  };
}

const row = (productStatus: string, ranging?: boolean) => ({
  _productStatus: productStatus,
  ...(ranging === undefined ? {} : { _rangingStatus: ranging }),
});

// ── Reading conditions ─────────────────────────────────────────
assert("list form reads back", scenarioClientStatuses({ clientStatuses: ["ACTIVE", "NEW"] }).join(",") === "ACTIVE,NEW");
assert("LEGACY single form still reads", scenarioClientStatuses({ clientStatus: "ACTIVE" }).join(",") === "ACTIVE");
assert("empty = unconstrained", scenarioClientStatuses({}).length === 0);
assert("empty list = unconstrained", scenarioClientStatuses({ clientStatuses: [] }).length === 0);
assert("case + whitespace normalised", scenarioClientStatuses({ clientStatuses: [" active ", "New"] }).join(",") === "ACTIVE,NEW");

// ── Normalising on write ───────────────────────────────────────
const norm = normaliseConditions({ clientStatus: "active" });
assert("legacy field is upgraded on save", norm.clientStatuses?.join(",") === "ACTIVE");
assert("legacy field is dropped on save", norm.clientStatus === undefined, JSON.stringify(norm));
assert("duplicates collapse", normaliseConditions({ clientStatuses: ["ACTIVE", "active"] }).clientStatuses?.length === 1);
assert("rangingStatus survives", normaliseConditions({ rangingStatus: false }).rangingStatus === false);
assert(
  "unconstrained saves as empty conditions",
  JSON.stringify(normaliseConditions({ clientStatuses: [] })) === "{}",
);

// ── Matching ───────────────────────────────────────────────────
const multi = [scenario({ clientStatuses: ["ACTIVE", "DISCONTINUED"] }, "NEGATIVE")];
assert("matches first listed status", evaluateScenarios("Z4", row("ACTIVE"), multi) === "NEGATIVE");
assert("matches second listed status", evaluateScenarios("Z4", row("DISCONTINUED"), multi) === "NEGATIVE");
assert("does not match an unlisted status", evaluateScenarios("Z4", row("NEW"), multi) === null);
assert("row status matched case-insensitively", evaluateScenarios("Z4", row("active"), multi) === "NEGATIVE");

const legacy = [scenario({ clientStatus: "ACTIVE" }, "POSITIVE")];
assert("LEGACY scenario still matches", evaluateScenarios("Z4", row("ACTIVE"), legacy) === "POSITIVE");
assert("LEGACY scenario still rejects", evaluateScenarios("Z4", row("NEW"), legacy) === null);

// ── Specificity ────────────────────────────────────────────────
const moreConditions = [
  scenario({ clientStatuses: ["ACTIVE"] }, "POSITIVE"),
  scenario({ clientStatuses: ["ACTIVE"], rangingStatus: true }, "NEGATIVE"),
];
assert(
  "more conditions still wins",
  evaluateScenarios("Z4", row("ACTIVE", true), moreConditions) === "NEGATIVE",
);

// The tie-break that multi-select makes necessary. Declared broad-first and
// narrow-first to prove the answer does not depend on stored order.
const broadFirst = [
  scenario({ clientStatuses: ["ACTIVE", "DISCONTINUED", "NEW"] }, "NEGATIVE"),
  scenario({ clientStatuses: ["ACTIVE"] }, "POSITIVE"),
];
const narrowFirst = [
  scenario({ clientStatuses: ["ACTIVE"] }, "POSITIVE"),
  scenario({ clientStatuses: ["ACTIVE", "DISCONTINUED", "NEW"] }, "NEGATIVE"),
];
assert("narrower wins (broad declared first)", evaluateScenarios("Z4", row("ACTIVE"), broadFirst) === "POSITIVE");
assert("narrower wins (narrow declared first)", evaluateScenarios("Z4", row("ACTIVE"), narrowFirst) === "POSITIVE");
assert(
  "broad still applies where narrow doesn't",
  evaluateScenarios("Z4", row("NEW"), broadFirst) === "NEGATIVE",
);
// A legacy single-status scenario must beat a broad list the same way.
assert(
  "LEGACY single beats a broad list",
  evaluateScenarios("Z4", row("ACTIVE"), [
    scenario({ clientStatuses: ["ACTIVE", "NEW"] }, "NEGATIVE"),
    scenario({ clientStatus: "ACTIVE" }, "POSITIVE"),
  ]) === "POSITIVE",
);

// Unconstrained scenarios stay the weakest fallback.
assert(
  "constrained beats unconstrained",
  evaluateScenarios("Z4", row("ACTIVE"), [
    scenario({}, "NEGATIVE"),
    scenario({ clientStatuses: ["ACTIVE"] }, "POSITIVE"),
  ]) === "POSITIVE",
);
assert(
  "unconstrained still catches everything else",
  evaluateScenarios("Z4", row("ANYTHING"), [scenario({}, "NEGATIVE")]) === "NEGATIVE",
);

// Other status codes are untouched.
assert("a different status code does not match", evaluateScenarios("Z9", row("ACTIVE"), multi) === null);

// ── Display ────────────────────────────────────────────────────
assert("summary: none", statusSummary([]) === "Any");
assert("summary: two listed", statusSummary(["ACTIVE", "NEW"]) === "ACTIVE, NEW");
assert("summary: many counted", statusSummary(["A", "B", "C"]) === "3 statuses");

console.log(failures === 0 ? "\nAll assertions passed\n" : `\n${failures} FAILED\n`);
process.exit(failures > 0 ? 1 : 0);
