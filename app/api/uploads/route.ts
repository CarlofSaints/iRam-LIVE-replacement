import { NextRequest } from "next/server";
import { getUploadIndex, getUploadsByClient, addUpload } from "@/lib/uploadData";
import { getClientById } from "@/lib/clientData";
import { getChannelById } from "@/lib/channelData";
import { parseDispo } from "@/lib/dispoParser";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import type { FileType } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    if (clientId) {
      return Response.json(await getUploadsByClient(clientId), { headers: noCacheHeaders() });
    }
    return Response.json(await getUploadIndex(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "upload_data");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clientId = formData.get("clientId") as string | null;
    const channelId = formData.get("channelId") as string | null;
    const fileType = formData.get("fileType") as FileType | null;

    if (!file || !clientId || !channelId || !fileType) {
      return Response.json({ error: "File, clientId, channelId, and fileType are required" }, { status: 400, headers: noCacheHeaders() });
    }

    const client = await getClientById(clientId);
    if (!client) return Response.json({ error: "Client not found" }, { status: 404, headers: noCacheHeaders() });

    const channel = await getChannelById(channelId);
    if (!channel) return Response.json({ error: "Channel not found" }, { status: 404, headers: noCacheHeaders() });

    const buffer = Buffer.from(await file.arrayBuffer());

    if (fileType === "dispo") {
      const result = parseDispo(buffer);

      // Validate vendor number
      if (result.vendorNumber && client.vendorNumbers.length > 0) {
        if (!client.vendorNumbers.includes(result.vendorNumber)) {
          return Response.json({
            error: `Vendor number ${result.vendorNumber} from file does not match client's vendor numbers (${client.vendorNumbers.join(", ")})`,
          }, { status: 400, headers: noCacheHeaders() });
        }
      }

      // Find parent channel for main channel name
      let mainChannelName = channel.name;
      let subChannelId: string | undefined;
      let subChannelName: string | undefined;
      if (channel.parentId) {
        const parent = await getChannelById(channel.parentId);
        mainChannelName = parent?.name ?? channel.name;
        subChannelId = channel.id;
        subChannelName = channel.name;
      }

      const upload = await addUpload(
        {
          clientId,
          clientName: client.name,
          channelId: channel.parentId ?? channel.id,
          channelName: mainChannelName,
          subChannelId,
          subChannelName,
          fileType: "dispo",
          fileName: file.name,
          uploadDate: new Date().toISOString(),
          uploadedBy: session.userId,
          uploadedByName: session.name,
          vendorNumber: result.vendorNumber,
          period: result.dateColumns.join(", "),
          rowCount: result.totalRows,
          dateColumns: result.dateColumns,
          status: "processed",
        },
        result.rows
      );

      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "upload_dispo",
        details: `Uploaded DISPO for ${client.name} / ${channel.name} (${result.totalRows} rows, vendor ${result.vendorNumber})`,
        status: "success",
      });

      return Response.json({ success: true, id: upload.id, rowCount: result.totalRows }, { headers: noCacheHeaders() });
    }

    if (fileType === "aged_stock") {
      return Response.json({ error: "Aged Stock parsing is not yet implemented" }, { status: 400, headers: noCacheHeaders() });
    }

    return Response.json({ error: "Invalid file type" }, { status: 400, headers: noCacheHeaders() });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Could not find header row")) {
      return Response.json({ error: err.message }, { status: 400, headers: noCacheHeaders() });
    }
    return handleAuthError(err);
  }
}
