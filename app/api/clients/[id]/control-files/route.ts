import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { del } from "@vercel/blob";
import { getClientById } from "@/lib/clientData";
import {
  saveControlFileData,
  saveRawPmfData,
  saveRawLinksData,
  parsePmfSheet,
  parseLinksSheet,
  parseRangingSheet,
  parseCustomSitesSheet,
  parsePromotionsSheet,
} from "@/lib/controlFileData";
import { getProductMapping, buildProductMaster } from "@/lib/productMasterData";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import type { ControlFileType } from "@/lib/types";

const PARSERS: Record<ControlFileType, (rows: Record<string, unknown>[]) => Record<string, unknown>[]> = {
  pmf: parsePmfSheet,
  links: parseLinksSheet,
  ranging: parseRangingSheet,
  custom_sites: parseCustomSitesSheet,
  promotions: parsePromotionsSheet,
};

// A Range Management file is ~20MB of Excel; reading and parsing it overruns the
// default function duration.
export const maxDuration = 300;

// Only fetch back files that live in our own Blob store, never an arbitrary URL.
function isOwnBlobUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let tempBlobUrl: string | null = null;
  try {
    const session = await requirePermission(req, "manage_control_files");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) return Response.json({ error: "Client not found" }, { status: 404, headers: noCacheHeaders() });

    // Large files arrive as JSON { blobUrl, fileName, type } after the browser has
    // uploaded them to Blob (see ./blob/route.ts); small ones still come as a form.
    let type: ControlFileType | null;
    let fileName: string;
    let buffer: Buffer;
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      const body = await req.json();
      type = (body.type ?? null) as ControlFileType | null;
      fileName = String(body.fileName || "upload.xlsx");
      tempBlobUrl = typeof body.blobUrl === "string" && isOwnBlobUrl(body.blobUrl) ? body.blobUrl : null;
      if (!tempBlobUrl) return Response.json({ error: "Missing uploaded file reference" }, { status: 400, headers: noCacheHeaders() });
      if (!type || !PARSERS[type]) return Response.json({ error: "Invalid file type" }, { status: 400, headers: noCacheHeaders() });
      const r = await fetch(tempBlobUrl);
      if (!r.ok) {
        return Response.json({ error: `Could not read the uploaded file back (HTTP ${r.status}). Please try again.` }, { status: 400, headers: noCacheHeaders() });
      }
      buffer = Buffer.from(await r.arrayBuffer());
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      type = formData.get("type") as ControlFileType | null;
      if (!file || !type) return Response.json({ error: "File and type are required" }, { status: 400, headers: noCacheHeaders() });
      if (!PARSERS[type]) return Response.json({ error: "Invalid file type" }, { status: 400, headers: noCacheHeaders() });
      fileName = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const parsed = PARSERS[type](rawRows);

    // Save raw rows so the mapping UI can detect all original headers
    const trimmedRaw = rawRows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) out[k.trim()] = v;
      return out;
    });
    if (type === "pmf") {
      await saveRawPmfData(id, trimmedRaw);
    }
    if (type === "links") {
      await saveRawLinksData(id, trimmedRaw);
    }

    await saveControlFileData(id, type, parsed, {
      fileName,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session.name,
      rowCount: parsed.length,
    });

    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "upload_control_file",
      details: `Uploaded ${type} for ${client.name} (${parsed.length} rows)`,
      status: "success",
      clientId: id,
      clientName: client.name,
    });

    // Auto-rebuild product master when PMF is re-uploaded (if a mapping exists)
    let productMasterCount: number | undefined;
    if (type === "pmf") {
      const mapping = await getProductMapping(id);
      if (mapping && mapping.clientProductId) {
        const result = await buildProductMaster(id);
        productMasterCount = result.count;
      }
    }

    return Response.json({ success: true, rowCount: parsed.length, productMasterCount }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  } finally {
    if (tempBlobUrl) {
      try { await del(tempBlobUrl); } catch { /* best-effort cleanup */ }
    }
  }
}
