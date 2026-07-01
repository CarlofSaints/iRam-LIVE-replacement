/* ──────────────────────────────────────────────────────────────
   SQL Proxy client — calls the shared Railway-hosted proxy that holds the
   SQL Server credentials (so no DB password lives in this app). Same proxy +
   env vars as the ARIA Scorecard portal: SQL_PROXY_URL + SQL_PROXY_API_KEY.
   ────────────────────────────────────────────────────────────── */

// Normalise the configured base URL: fetch() needs an absolute URL with a
// scheme, so a value like "host.up.railway.app" (no https://) throws
// "Failed to parse URL". Prepend https:// when missing and drop trailing slashes.
function normalizeBase(raw: string): string {
  const u = raw.trim().replace(/\/+$/, "");
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

const PROXY_URL = normalizeBase(process.env.SQL_PROXY_URL || "");
const PROXY_KEY = process.env.SQL_PROXY_API_KEY || "";

export interface ProxyResponse<T = Record<string, unknown>> {
  data: T[];
  count: number;
}

export function isProxyConfigured(): boolean {
  return !!PROXY_URL && !!PROXY_KEY;
}

export async function sqlQuery<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {},
): Promise<ProxyResponse<T>> {
  if (!PROXY_URL || !PROXY_KEY) {
    throw new Error("SQL_PROXY_URL or SQL_PROXY_API_KEY not configured");
  }
  const res = await fetch(`${PROXY_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PROXY_KEY },
    body: JSON.stringify({ query, params }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SQL proxy error (${res.status}): ${body}`);
  }
  return res.json() as Promise<ProxyResponse<T>>;
}

// Today's Massmart store visits / check-ins (the store-report trigger source).
export async function getTodayMassmartVisits(): Promise<Record<string, unknown>[]> {
  const r = await sqlQuery<Record<string, unknown>>("massmart_visits_today");
  return r.data || [];
}
