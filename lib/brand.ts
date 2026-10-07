/* ── One codebase, two deployments ──
   iRam's (behind the iRam Hub, iRam's own SQL Server and SharePoint) and
   OuterJoin's (ARIA, sold to clients directly). NEXT_PUBLIC_BRAND is set per
   Vercel project and inlined at build time, so server and browser agree.

   UNSET = iram, so the deployment that existed before this file behaves
   exactly as it did. Client-safe: no server imports, the Sidebar reads it.

   `features` switches off the connections only iRam has. A switch that is
   off means the code path does not run at all, rather than running and
   failing every 3 minutes against a server this deployment can't reach. */

export type BrandKey = "iram" | "oj";

export interface PartnerLogo {
  /** path under /public */
  src: string;
  alt: string;
}

export interface Brand {
  key: BrandKey;
  /** the product name in titles, headers, email subjects */
  product: string;
  /** who runs it, in sentences: "saved to {company}" */
  company: string;
  /** sidebar/login second line */
  tagline: string;
  /** logos in the store-report footer and on the report page, left to right */
  reportLogos: PartnerLogo[];
  /** Resend sender. The domain must be verified in Resend. */
  emailFrom: string;
  /** colours: brand palette, not nearest-swatch */
  colors: { primary: string; primaryDark: string; secondary: string; accent: string };
  features: {
    /** sign-in through the iRam Hub (otherwise the email + password form) */
    hubSso: boolean;
    /** store-report MAIN feed: iRam's Perigee DB via the SQL proxy SP */
    iramVisitFeed: boolean;
    /** client names must be on iRam's SQL "IRAM Live" client list */
    sqlClientList: boolean;
    /** DISPO filing check against iRam's SharePoint */
    sharepointFiling: boolean;
  };
}

const BRANDS: Record<BrandKey, Brand> = {
  iram: {
    key: "iram",
    product: "iRam LIVE",
    company: "iRam",
    tagline: "OuterJoin",
    reportLogos: [
      { src: "/brand/iram.png", alt: "iRAM" },
      { src: "/brand/outerjoin.png", alt: "OUTERJOIN" },
    ],
    emailFrom: "iRam LIVE <noreply@outerjoin.co.za>",
    colors: { primary: "#7CC042", primaryDark: "#5ea32e", secondary: "#3D6273", accent: "#E04E2A" },
    features: { hubSso: true, iramVisitFeed: true, sqlClientList: true, sharepointFiling: true },
  },
  oj: {
    key: "oj",
    product: "ARIA",
    company: "OuterJoin",
    tagline: "by OuterJoin",
    reportLogos: [
      { src: "/brand/aria.png", alt: "ARIA" },
      { src: "/brand/outerjoin.png", alt: "OUTERJOIN" },
    ],
    emailFrom: "ARIA <noreply@outerjoin.co.za>",
    // OuterJoin palette: slate, charcoal, orange (the ARIA logo's own colours).
    colors: { primary: "#3F5A6B", primaryDark: "#2D3748", secondary: "#2D3748", accent: "#E04E2A" },
    features: { hubSso: false, iramVisitFeed: false, sqlClientList: false, sharepointFiling: false },
  },
};

export const brand: Brand = BRANDS[process.env.NEXT_PUBLIC_BRAND === "oj" ? "oj" : "iram"];

/** This deployment's own address, for links in emails. NEVER the request's
 *  Host header. NEXT_PUBLIC_SITE_URL was the only source and is not set on
 *  iRam's deployment, so reset and welcome emails linked to localhost:3000.
 *  Vercel's VERCEL_PROJECT_PRODUCTION_URL is the project's production domain
 *  on every deployment, so each brand gets its own without configuration.
 *  Server-side only (the Vercel variable is not inlined into the browser). */
export function siteUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (prod) return `https://${prod}`;
  return "http://localhost:3000";
}
