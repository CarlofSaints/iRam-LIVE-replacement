import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getClientById } from "@/lib/clientData";
import {
  getControlFileData,
  getRawPmfData,
  getRawLinksData,
} from "@/lib/controlFileData";
import {
  requireLogin,
  assertClientAccess,
  noCacheHeaders,
  handleAuthError,
} from "@/lib/auth";
import type { ControlFileType } from "@/lib/types";
import { contentDisposition } from "@/lib/contentDisposition";

export const dynamic = "force-dynamic";

const VALID: ControlFileType[] = [
  "pmf",
  "links",
  "ranging",
  "custom_sites",
  "promotions",
];

/**
 * Download the control file currently loaded for a client, rebuilt as an .xlsx
 * from the stored data. For PMF/LINKS we use the raw (all-columns) snapshot;
 * other types use the parsed rows. Lets a user see exactly what the system holds.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
) {
  try {
    const session = requireLogin(req);
    const { id, type } = await params;
    assertClientAccess(session, id);

    if (!VALID.includes(type as ControlFileType)) {
      return Response.json(
        { error: "Invalid control file type" },
        { status: 400, headers: noCacheHeaders() },
      );
    }
    const fileType = type as ControlFileType;

    const client = await getClientById(id);
    if (!client) {
      return Response.json(
        { error: "Client not found" },
        { status: 404, headers: noCacheHeaders() },
      );
    }

    const meta = client.controlFiles?.[fileType];
    if (!meta) {
      return Response.json(
        { error: "No file loaded for this control file" },
        { status: 404, headers: noCacheHeaders() },
      );
    }

    // Prefer the raw (all-columns) snapshot for PMF/LINKS; fall back to parsed.
    let rows: Record<string, unknown>[] = [];
    if (fileType === "pmf") {
      rows = await getRawPmfData(id);
      if (rows.length === 0) rows = await getControlFileData(id, fileType);
    } else if (fileType === "links") {
      rows = await getRawLinksData(id);
      if (rows.length === 0) rows = await getControlFileData(id, fileType);
    } else {
      rows = await getControlFileData(id, fileType);
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });

    // Keep the original filename where possible; ensure an .xlsx extension.
    const baseName = (meta.fileName || `${fileType}.xlsx`).replace(
      /\.(xlsx|xls|csv)$/i,
      "",
    );
    const downloadName = `${baseName}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(downloadName),
        ...noCacheHeaders(),
      },
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
