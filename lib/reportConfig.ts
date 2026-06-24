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
