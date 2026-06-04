/**
 * Seed status definitions to a deployed instance.
 *
 * Usage:
 *   npx tsx scripts/seed-statuses.ts <BASE_URL> <SEED_SECRET>
 *
 * Example:
 *   npx tsx scripts/seed-statuses.ts https://iram-live.vercel.app oj-seed-2026
 */

interface SeedEntry {
  code: string;
  channelName: string;
  classification: "POSITIVE" | "NEGATIVE" | "UNCLASSIFIED";
  description: string;
  notes?: string;
}

const MAKRO: SeedEntry[] = [
  { code: "A", channelName: "MAKRO (MAIN)", classification: "POSITIVE", description: "Archived", notes: "Product archived at retailer. Cross-ref with PMF: POSITIVE if PMF also inactive, NEGATIVE if PMF still ACTIVE." },
  { code: "B", channelName: "MAKRO (MAIN)", classification: "UNCLASSIFIED", description: "Liquor Vintages", notes: "Liquor vintage-specific status. Context-dependent." },
  { code: "BA", channelName: "MAKRO (MAIN)", classification: "UNCLASSIFIED", description: "MF-BOM Article", notes: "Bill of Materials article. Context-dependent." },
  { code: "C", channelName: "MAKRO (MAIN)", classification: "UNCLASSIFIED", description: "Web Special Order", notes: "Web/special order only. Context-dependent." },
  { code: "D", channelName: "MAKRO (MAIN)", classification: "POSITIVE", description: "Discontinued", notes: "POSITIVE if PMF status is also DISCONTINUED (statuses match). NEGATIVE if PMF status is ACTIVE (retailer dropped an active product — lost sales)." },
  { code: "H", channelName: "MAKRO (MAIN)", classification: "POSITIVE", description: "Harmonized", notes: "Product harmonized to a new article number. Expected behaviour." },
  { code: "M", channelName: "MAKRO (MAIN)", classification: "NEGATIVE", description: "Markdown", notes: "Product on markdown — orders blocked. Needs attention if product is still ACTIVE in PMF." },
  { code: "N", channelName: "MAKRO (MAIN)", classification: "NEGATIVE", description: "Not Replenished", notes: "Replenishment stopped. NEGATIVE if PMF status is ACTIVE (should be replenishing). Check with retailer buyer." },
  { code: "R", channelName: "MAKRO (MAIN)", classification: "UNCLASSIFIED", description: "Customer Orders", notes: "Customer order only — not regular replenishment. Context-dependent." },
  { code: "S", channelName: "MAKRO (MAIN)", classification: "NEGATIVE", description: "Suspended", notes: "Product suspended at retailer. NEGATIVE if PMF status is ACTIVE. May indicate compliance/quality issue." },
  { code: "U", channelName: "MAKRO (MAIN)", classification: "POSITIVE", description: "To be Harmonized", notes: "Pending harmonization to new article. Expected transitional status." },
  { code: "V", channelName: "MAKRO (MAIN)", classification: "POSITIVE", description: "Vendor Discontinuation", notes: "Vendor discontinued this product. POSITIVE if PMF also DISCONTINUED. NEGATIVE if PMF still ACTIVE (supplier ended it but client has not updated PMF)." },
  { code: "X", channelName: "MAKRO (MAIN)", classification: "POSITIVE", description: "Product Recall", notes: "Product recalled — blocking is correct. Verify recall is acknowledged internally." },
];

const MASSBUILD: SeedEntry[] = [
  { code: "0", channelName: "MASSBUILD", classification: "POSITIVE", description: "Active", notes: "Product is active and replenishing normally. 0 or blank = same status. POSITIVE — no order block." },
  { code: "A", channelName: "MASSBUILD", classification: "NEGATIVE", description: "Customer Temp", notes: "Temporarily suspended for a customer. NEGATIVE if PMF status is ACTIVE — orders are blocked on a live product." },
  { code: "B", channelName: "MASSBUILD", classification: "POSITIVE", description: "Buyer Discontinued", notes: "Buyer has discontinued the product. POSITIVE if PMF also DISCONTINUED. NEGATIVE if PMF still ACTIVE (retailer dropped an active product)." },
  { code: "C", channelName: "MASSBUILD", classification: "UNCLASSIFIED", description: "Catalogue Stock", notes: "Catalogue/special order stock. Context-dependent." },
  { code: "D", channelName: "MASSBUILD", classification: "POSITIVE", description: "Discon Import Stock", notes: "Discontinued imported stock. POSITIVE if PMF also DISCONTINUED. NEGATIVE if PMF still ACTIVE." },
  { code: "M", channelName: "MASSBUILD", classification: "NEGATIVE", description: "Markdown", notes: "Product on markdown — orders blocked. Needs attention if product is still ACTIVE in PMF." },
  { code: "N", channelName: "MASSBUILD", classification: "NEGATIVE", description: "Temp Suspended", notes: "Temporarily suspended. NEGATIVE if PMF status is ACTIVE — should be trading. Check with buyer." },
  { code: "P", channelName: "MASSBUILD", classification: "NEGATIVE", description: "Special Suspended", notes: "Special suspension applied. NEGATIVE if PMF status is ACTIVE. Investigate reason for suspension." },
  { code: "R", channelName: "MASSBUILD", classification: "POSITIVE", description: "Discon Local Stock", notes: "Discontinued local stock. POSITIVE if PMF also DISCONTINUED. NEGATIVE if PMF still ACTIVE." },
  { code: "S", channelName: "MASSBUILD", classification: "UNCLASSIFIED", description: "Seasonal Stock", notes: "Seasonal product — may be intentionally blocked off-season. Context-dependent on time of year." },
  { code: "T", channelName: "MASSBUILD", classification: "NEGATIVE", description: "Aged Stock", notes: "Aged/slow-moving stock. NEGATIVE — indicates potential ranging or demand issue." },
  { code: "V", channelName: "MASSBUILD", classification: "UNCLASSIFIED", description: "Direct Del", notes: "Direct delivery product. Context-dependent — different replenishment model." },
  { code: "X", channelName: "MASSBUILD", classification: "NEGATIVE", description: "Block at POS", notes: "Blocked at point of sale. NEGATIVE if PMF status is ACTIVE — product cannot be sold." },
  { code: "Y", channelName: "MASSBUILD", classification: "POSITIVE", description: "To be Archived", notes: "Pending archival. POSITIVE if PMF also DISCONTINUED. NEGATIVE if PMF still ACTIVE." },
  { code: "Z", channelName: "MASSBUILD", classification: "POSITIVE", description: "National Product Recall", notes: "Product recalled nationally — blocking is correct. Verify recall is acknowledged internally." },
];

async function main() {
  const baseUrl = process.argv[2];
  const secret = process.argv[3];

  if (!baseUrl || !secret) {
    console.error("Usage: npx tsx scripts/seed-statuses.ts <BASE_URL> <SEED_SECRET>");
    process.exit(1);
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/status-definitions/seed`;
  const allStatuses = [...MAKRO, ...MASSBUILD];

  console.log(`Seeding ${allStatuses.length} statuses to ${url} ...`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seed-secret": secret,
    },
    body: JSON.stringify({ statuses: allStatuses }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Seed failed:", res.status, data);
    process.exit(1);
  }

  console.log("Done:", data);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
