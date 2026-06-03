import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getStoreFileIndex, addStoreFile, parseStoreExcel } from "@/lib/storeFileData";
import { getChannels, ensureSubChannels } from "@/lib/channelData";
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

    if (!file) return Response.json({ error: "File is required" }, { status: 400, headers: noCacheHeaders() });

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

    // Auto-detect channels from file data
    const uniqueChannelNames = new Set<string>();
    for (const r of records) {
      const ch = r.channel.trim().toUpperCase();
      if (ch) uniqueChannelNames.add(ch);
    }

    if (uniqueChannelNames.size === 0) {
      return Response.json(
        { error: "No channel values found in the file's Channel column" },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    // Match to existing main channels
    const allChannels = await getChannels();
    const mainChannels = allChannels.filter((c) => !c.parentId);
    const matchedMainIds: string[] = [];
    const unrecognized: string[] = [];

    for (const name of uniqueChannelNames) {
      const match = mainChannels.find((c) => c.name.toUpperCase() === name);
      if (match) {
        matchedMainIds.push(match.id);
      } else {
        unrecognized.push(name);
      }
    }

    if (unrecognized.length > 0) {
      return Response.json(
        { error: `Unrecognized channels in file: ${unrecognized.join(", ")}. Create these as main channels first.` },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    // Auto-create sub-channels per main channel
    for (const mainId of matchedMainIds) {
      const mainChannel = mainChannels.find((c) => c.id === mainId)!;
      const subNames = new Set<string>();
      for (const r of records) {
        if (r.channel.trim().toUpperCase() === mainChannel.name.toUpperCase() && r.subChannel.trim()) {
          subNames.add(r.subChannel.trim());
        }
      }
      if (subNames.size > 0) {
        await ensureSubChannels(mainId, Array.from(subNames));
      }
    }

    const storeFile = await addStoreFile(
      {
        fileName: file.name,
        mainChannelIds: matchedMainIds,
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
      details: `Uploaded store file ${file.name} (${records.length} stores, channels: ${Array.from(uniqueChannelNames).join(", ")})`,
      status: "success",
    });

    return Response.json(storeFile, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
