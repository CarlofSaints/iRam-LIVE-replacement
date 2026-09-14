/* Reader-facing wording for the stock-health measures.

   In its own file with NO imports because the Portfolio Stock Health page is a
   client component: importing this from lib/stockFlags.ts would drag in
   monthEndReport -> statusScenarioData -> blob -> node:fs and fail the build.
   The rules stay in lib/stockFlags.ts; only the sentences live here, so the
   page and the engine still describe the same thing from one place. */

/** Printed under the KPI tiles so nobody adds them up. */
export const KPI_NOTES =
  "Negative SOH is counted inside Out of Stock, not beside it. A line can carry " +
  "more than one measure at once, so these figures overlap by design and must " +
  "not be added together.";
