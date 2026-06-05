import { NextRequest } from "next/server";
import { resetAllChannels } from "@/lib/channelData";
import { getStoreFileIndex } from "@/lib/storeFileData";
import { deleteBlob } from "@/lib/blob";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

/**
 * POST /api/channels/reset
 * Wipes all channels, store files, and related flags.
 * After this, channels will re-seed with defaults (MAKRO, GAME, MASSBUILD).
 * User must then re-upload store control files to recreate sub-channels.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_channels");

    // Load store file index before wiping so we can delete individual files
    const storeFiles = await getStoreFileIndex();

    // Wipe channels + flags
    await resetAllChannels();

    // Wipe store files (index, merged, and each individual file)
    await deleteBlob("store-files/index.json");
    await deleteBlob("store-files/merged.json");
    for (const f of storeFiles) {
      await deleteBlob(`store-files/${f.id}.json`);
    }

    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "reset_channels",
      details: `Reset all channels and store files (${storeFiles.length} store files removed)`,
      status: "success",
    });

    return Response.json(
      { ok: true, message: "Channels and store files wiped. Defaults re-seeded on next load." },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
