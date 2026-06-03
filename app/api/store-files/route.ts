import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getStoreFileIndex, addStoreFile, parseStoreExcel } from "@/lib/storeFileData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    return Response.json(await getStoreFileIndex(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_files");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const subChannelIdsRaw = formData.get("subChannelIds") as string | null;

    if (!file) return Response.json({ error: "File is required" }, { status: 400, headers: noCacheHeaders() });

    let subChannelIds: string[] = [];
    try {
      subChannelIds = JSON.parse(subChannelIdsRaw || "[]");
    } catch {
      return Response.json({ error: "Invalid subChannelIds" }, { status: 400, headers: noCacheHeaders() });
    }

    if (subChannelIds.length === 0) {
      return Response.json({ error: "Select at least one sub-channel" }, { status: 400, headers: noCacheHeaders() });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    // Find the MASTER_SITE sheet or use first sheet
    let sheetName = workbook.SheetNames[0];
    for (const name of workbook.SheetNames) {
      if (name.toLowerCase().includes("master") || name.toLowerCase().includes("site")) {
        sheetName = name;
        break;
      }
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const records = parseStoreExcel(rawRows);

    if (records.length === 0) {
      return Response.json({ error: "No valid store records found in file" }, { status: 400, headers: noCacheHeaders() });
    }

    const storeFile = await addStoreFile(
      {
        fileName: file.name,
        subChannelIds,
        uploadedAt: new Date().toISOString(),
        uploadedBy: session.name,
        rowCount: records.length,
      },
      records
    );

    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "upload_store_file",
      details: `Uploaded store file ${file.name} (${records.length} stores)`,
      status: "success",
    });

    return Response.json(storeFile, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
