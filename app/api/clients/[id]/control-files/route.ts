import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getClientById } from "@/lib/clientData";
import {
  saveControlFileData,
  saveRawPmfData,
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_control_files");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) return Response.json({ error: "Client not found" }, { status: 404, headers: noCacheHeaders() });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as ControlFileType | null;

    if (!file || !type) return Response.json({ error: "File and type are required" }, { status: 400, headers: noCacheHeaders() });
    if (!PARSERS[type]) return Response.json({ error: "Invalid file type" }, { status: 400, headers: noCacheHeaders() });

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const parsed = PARSERS[type](rawRows);

    // Save raw rows for PMF so the mapping UI can detect all original headers
    if (type === "pmf") {
      await saveRawPmfData(id, rawRows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) out[k.trim()] = v;
        return out;
      }));
    }

    await saveControlFileData(id, type, parsed, {
      fileName: file.name,
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
    });

    // Auto-rebuild product master when PMF is re-uploaded (if a mapping exists)
    let productMasterCount: number | undefined;
    if (type === "pmf") {
      const mapping = await getProductMapping(id);
      if (mapping && mapping.article) {
        const result = await buildProductMaster(id);
        productMasterCount = result.count;
      }
    }

    return Response.json({ success: true, rowCount: parsed.length, productMasterCount }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
