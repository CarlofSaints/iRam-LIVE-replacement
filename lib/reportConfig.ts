/* ──────────────────────────────────────────────────────────────
   Report Configuration — per-client DSC brackets + SP URLs
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";

// ── Types ─────────────────────────────────────────────────────

export interface DSCBrackets {
  oosThreshold: number;   // below this = "Out of Stock" (default 2)
  alertThreshold: number; // at or above this = "ALERT" (default 90)
}

export interface ReportConfig {
  dscBrackets: DSCBrackets;
  otoMultipliers: Record<string, number>; // category (lowercase) → RP multiplier (default 1)
  spUrls: Record<string, string>; // reportType → SP folder URL
}

// ── Defaults ──────────────────────────────────────────────────

export const DEFAULT_DSC_BRACKETS: DSCBrackets = {
  oosThreshold: 2,
  alertThreshold: 90,
};

const DEFAULT_CONFIG: ReportConfig = {
  dscBrackets: { ...DEFAULT_DSC_BRACKETS },
  otoMultipliers: {},
  spUrls: {},
};

// ── Blob key ──────────────────────────────────────────────────

function configKey(clientId: string): string {
  return `clients/${clientId}/report-config.json`;
}

// ── CRUD ──────────────────────────────────────────────────────

export async function getReportConfig(
  clientId: string
): Promise<ReportConfig> {
  const stored = await readJson<ReportConfig | null>(configKey(clientId), null);
  if (!stored) return { ...DEFAULT_CONFIG, dscBrackets: { ...DEFAULT_DSC_BRACKETS }, otoMultipliers: {} };
  return {
    dscBrackets: {
      oosThreshold: stored.dscBrackets?.oosThreshold ?? DEFAULT_DSC_BRACKETS.oosThreshold,
      alertThreshold: stored.dscBrackets?.alertThreshold ?? DEFAULT_DSC_BRACKETS.alertThreshold,
    },
    otoMultipliers: stored.otoMultipliers ?? {},
    spUrls: stored.spUrls ?? {},
  };
}

export async function saveReportConfig(
  clientId: string,
  config: ReportConfig
): Promise<void> {
  await writeJson(configKey(clientId), config);
}

// ── DSC Classification ────────────────────────────────────────

export function classifyDSC(actDsc: number, brackets: DSCBrackets): string {
  if (actDsc < brackets.oosThreshold) return "Out of Stock";
  // Anything at or above the alert threshold is an ALERT. Checked first so the
  // threshold actually governs (lowering it to 90 flags 90+ days, not just 210+).
  // Behaviour-preserving for the legacy 300 default (210-300 band still shown below).
  if (actDsc >= brackets.alertThreshold) return "ALERT";
  if (actDsc < 10) return "0-10";
  if (actDsc < 90) return "10-90";
  if (actDsc < 150) return "90-150";
  if (actDsc < 210) return "150-210";
  return `210-${brackets.alertThreshold}`;
}

// The ordered set of DSC bracket labels classifyDSC can emit for a given
// threshold, from no cover (Out of Stock) through to overstock (ALERT). Bands
// above the alert threshold are unreachable (everything ≥ alert is ALERT), so
// the list collapses as the threshold lowers — e.g. at the default 90 only
// "Out of Stock", "0-10", "10-90", "ALERT" are reachable. Used to lay out the
// DSC summary tables deterministically (one column/row per reachable bracket).
export function dscBracketLabels(brackets: DSCBrackets): string[] {
  const alert = brackets.alertThreshold;
  const labels = ["Out of Stock"];
  if (alert > 0) labels.push("0-10");
  if (alert > 10) labels.push("10-90");
  if (alert > 90) labels.push("90-150");
  if (alert > 150) labels.push("150-210");
  if (alert > 210) labels.push(`210-${alert}`);
  labels.push("ALERT");
  return labels;
}
