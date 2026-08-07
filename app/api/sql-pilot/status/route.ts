import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { isProxyConfigured, sqlQuery, proxyHealth, listProxyQueries } from "@/lib/sqlProxy";
import { SQL_SOURCES } from "@/lib/sqlSources";
import { getActiveClients } from "@/lib/clientData";

/* Is the SQL Direct pilot actually able to reach anything, and do the sources
   it needs exist on the proxy? Answers all of that in one call so the page can
   say WHICH part is missing rather than just failing. Read-only. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_sql_pilot");

    if (!isProxyConfigured()) {
      return Response.json(
        {
          configured: false,
          error:
            "SQL_PROXY_URL and/or SQL_PROXY_API_KEY are not set on this deployment. " +
            "They are the same values the ARIA Scorecard portal and the store-report cron use.",
        },
        { headers: noCacheHeaders() },
      );
    }

    const [health, registry, sqlClients, iramClients] = await Promise.all([
      proxyHealth().catch((e) => ({ ok: false, error: String(e) })),
      listProxyQueries().catch(() => [] as { name: string; description: string }[]),
      sqlQuery<Record<string, unknown>>("list_clients")
        .then((r) => r.data)
        .catch(() => [] as Record<string, unknown>[]),
      getActiveClients().catch(() => []),
    ]);

    const available = new Set(registry.map((q) => q.name));
    const sources = SQL_SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      replaces: s.replaces,
      query: s.query,
      proc: s.proc,
      channel: s.channel ?? null,
      notes: s.notes ?? null,
      // A source is only usable if the proxy actually registers its query.
      availableOnProxy: available.size === 0 ? null : available.has(s.query),
    }));

    /* The SQL side keys everything on a client NAME string, iRam on its own
       client records. They are not guaranteed to match, and a silent mismatch
       would look exactly like "SQL has no data for this client" — so the page
       shows both lists and flags exact-name matches. */
    const sqlNames = sqlClients
      .map((c) => String(c.Client ?? "").trim())
      .filter(Boolean)
      .sort();
    const sqlNameSet = new Set(sqlNames.map((n) => n.toUpperCase()));

    const clientMatching = iramClients
      .map((c) => ({
        iramName: c.name,
        iramId: c.id,
        exactMatch: sqlNameSet.has(c.name.trim().toUpperCase()),
      }))
      .sort((a, b) => Number(a.exactMatch) - Number(b.exactMatch) || a.iramName.localeCompare(b.iramName));

    return Response.json(
      {
        configured: true,
        health,
        proxyQueryCount: registry.length,
        sources,
        sqlClientCount: sqlNames.length,
        sqlClientNames: sqlNames,
        clientMatching,
        matchedCount: clientMatching.filter((c) => c.exactMatch).length,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
