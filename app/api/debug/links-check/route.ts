import { NextRequest } from "next/server";
import { getLinksMapping, getLinksLookup, normalizeArticle } from "@/lib/linksLookup";
import { getRawLinksData } from "@/lib/controlFileData";
import { getClientById } from "@/lib/clientData";
import { requireLogin, noCacheHeaders, handleAuthError } from "@/lib/auth";

/**
 * GET /api/debug/links-check?clientId=...
 * Diagnostic: shows LINKS mapping, raw data sample, and lookup keys.
 * DELETE THIS AFTER DEBUGGING.
 */
export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) return Response.json({ error: "clientId required" }, { status: 400 });

    const client = await getClientById(clientId);
    if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

    const mapping = await getLinksMapping(clientId);
    const rawRows = await getRawLinksData(clientId);
    const lookup = await getLinksLookup(clientId);

    // Sample first 5 raw rows (with all keys and types)
    const rawSample = rawRows.slice(0, 5).map((row) => {
      const out: Record<string, { value: unknown; type: string; normalized: string }> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = { value: v, type: typeof v, normalized: normalizeArticle(v) };
      }
      return out;
    });

    // All unique keys in raw data
    const allKeys = new Set<string>();
    for (const row of rawRows.slice(0, 20)) {
      for (const k of Object.keys(row)) allKeys.add(k);
    }

    // If mapping exists, show what the article column resolves to
    let articleSample: { raw: unknown; type: string; normalized: string }[] = [];
    if (mapping?.article) {
      articleSample = rawRows.slice(0, 10).map((row) => {
        const val = row[mapping.article];
        return {
          raw: val,
          type: typeof val,
          normalized: normalizeArticle(val),
        };
      });
    }

    // Lookup keys sample
    const lookupKeys = Array.from(lookup.keys()).slice(0, 15);

    return Response.json(
      {
        clientName: client.name,
        mapping,
        rawRowCount: rawRows.length,
        allRawKeys: Array.from(allKeys),
        rawSample,
        articleColumnName: mapping?.article ?? "(no mapping)",
        articleSample,
        lookupSize: lookup.size,
        lookupKeysSample: lookupKeys,
      },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
