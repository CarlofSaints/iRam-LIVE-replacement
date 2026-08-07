import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders, AuthError } from "@/lib/auth";
import { sqlQuery, isProxyConfigured } from "@/lib/sqlProxy";
import { getSqlSource, collectColumns, columnFill } from "@/lib/sqlSources";

/* Pull one source for one client and describe what came back — row count,
   columns, how populated each column is, and a handful of sample rows.

   READ-ONLY BY CONSTRUCTION: this route calls the proxy and returns what it
   got. It writes nothing to blob, does not touch the sales ledger, the store
   master, control files or the upload index, and has no side effects on the
   manual load path. That is the whole point of the pilot — prove the data
   before trusting it.

   These SPs can return a lot of rows (the sales ones are DISPO-scale), so the
   response is capped to a sample; the count is the real count. */
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  try {
    await requirePermission(req, "view_sql_pilot");

    if (!isProxyConfigured()) {
      return Response.json(
        { error: "SQL proxy is not configured on this deployment." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const url = new URL(req.url);
    const sourceId = url.searchParams.get("source") || "";
    const client = (url.searchParams.get("client") || "").trim();
    const yearMonth = (url.searchParams.get("yearMonth") || "").trim();
    const sampleRows = Math.min(Number(url.searchParams.get("sample")) || 10, 50);

    const source = getSqlSource(sourceId);
    if (!source) {
      return Response.json(
        { error: `Unknown source '${sourceId}'` },
        { status: 400, headers: noCacheHeaders() },
      );
    }
    if (!client) {
      return Response.json(
        { error: "A SQL client name is required — see the client list on the status panel." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const params: Record<string, unknown> = { client };
    // Only the sales SPs take a month, and only when one was actually given —
    // omitting it keeps the SP on its default (latest data).
    if (source.kind === "sales" && /^\d{4}-\d{2}$/.test(yearMonth)) {
      params.yearMonth = yearMonth;
    }

    const result = await sqlQuery<Record<string, unknown>>(source.query, params);
    const rows = result.data ?? [];
    const columns = collectColumns(rows);

    return Response.json(
      {
        source: {
          id: source.id, label: source.label, replaces: source.replaces,
          query: source.query, proc: source.proc, channel: source.channel ?? null,
        },
        client,
        yearMonth: params.yearMonth ?? null,
        rowCount: rows.length,
        columnCount: columns.length,
        columns: columnFill(rows, columns),
        sample: rows.slice(0, sampleRows),
        elapsedMs: Date.now() - startedAt,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    /* Name the failure. A stored procedure that does not exist, a login without
       EXECUTE, and a proxy that cannot reach SQL all surface here and are
       otherwise indistinguishable. */
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `SQL probe failed: ${detail}`, detail, elapsedMs: Date.now() - startedAt },
      { status: 500, headers: noCacheHeaders() },
    );
  }
}
