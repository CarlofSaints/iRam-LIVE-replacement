import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { getRawLinksData } from "@/lib/controlFileData";
import {
  getLinksMapping,
  saveLinksMapping,
  autoMatchLinksHeaders,
} from "@/lib/linksLookup";
import { addLog } from "@/lib/activityLog";
import type { LinksFieldMapping } from "@/lib/types";

/**
 * GET — returns current links mapping + detected headers + auto-match suggestions.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(req, "manage_control_files");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return Response.json(
        { error: "Client not found" },
        { status: 404, headers: noCacheHeaders() }
      );
    }

    const [mapping, rawRows] = await Promise.all([
      getLinksMapping(id),
      getRawLinksData(id),
    ]);

    const headers =
      rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
    const autoMatched = headers.length > 0 ? autoMatchLinksHeaders(headers) : {};

    // Count existing article links so the badge shows correctly on page load
    let linkCount = 0;
    if (mapping && mapping.article && mapping.clientProductId) {
      for (const row of rawRows) {
        const a = row[mapping.article];
        const c = row[mapping.clientProductId];
        if (a && String(a).trim() && c && String(c).trim()) linkCount++;
      }
    }

    return Response.json(
      { mapping, headers, autoMatched, linkCount },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

/**
 * PUT — saves links field mapping.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_control_files");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return Response.json(
        { error: "Client not found" },
        { status: 404, headers: noCacheHeaders() }
      );
    }

    const body = (await req.json()) as { mapping: LinksFieldMapping };

    if (!body.mapping || !body.mapping.article || !body.mapping.clientProductId) {
      return Response.json(
        { error: "Both Article and Client Product ID field mappings are required" },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    await saveLinksMapping(id, body.mapping);

    // Count how many article→cpid links we can build with this mapping
    const rawRows = await getRawLinksData(id);
    let linkCount = 0;
    for (const row of rawRows) {
      const a = row[body.mapping.article];
      const c = row[body.mapping.clientProductId];
      if (a && String(a).trim() && c && String(c).trim()) linkCount++;
    }

    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "save_links_mapping",
      details: `Saved links mapping for ${client.name} — ${linkCount} article links`,
      status: "success",
    });

    return Response.json(
      { success: true, linkCount },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
