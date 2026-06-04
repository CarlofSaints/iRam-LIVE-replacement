import { NextRequest } from "next/server";
import { upsertStatus, getStatusDefinitions } from "@/lib/statusData";
import { getChannels } from "@/lib/channelData";
import { noCacheHeaders } from "@/lib/auth";
import type { StatusClassification } from "@/lib/types";

interface SeedEntry {
  code: string;
  channelName: string;  // resolved to actual channelId at runtime
  classification: StatusClassification;
  description: string;
  notes?: string;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-seed-secret");
  if (!secret || secret !== process.env.SUPER_ADMIN_SEED_SECRET) {
    return Response.json({ error: "Invalid seed secret" }, { status: 403, headers: noCacheHeaders() });
  }

  try {
    const { statuses } = (await req.json()) as { statuses: SeedEntry[] };
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return Response.json({ error: "statuses array is required" }, { status: 400, headers: noCacheHeaders() });
    }

    // Resolve channel names to actual IDs
    const channels = await getChannels();
    const nameToId = new Map<string, string>();
    for (const ch of channels) {
      nameToId.set(ch.name.toUpperCase(), ch.id);
    }

    let created = 0;
    let updated = 0;
    const skipped: string[] = [];

    for (const s of statuses) {
      const channelId = nameToId.get(s.channelName.toUpperCase());
      if (!channelId) {
        skipped.push(`${s.code} (channel "${s.channelName}" not found)`);
        continue;
      }
      const { isNew } = await upsertStatus({
        code: s.code,
        channelId,
        classification: s.classification,
        description: s.description,
        notes: s.notes,
      });
      if (isNew) created++;
      else updated++;
    }

    // Clean up orphaned statuses whose channelId doesn't match any real channel
    const validIds = new Set(nameToId.values());
    const allStatuses = await getStatusDefinitions();
    const clean = allStatuses.filter((s) => validIds.has(s.channelId));
    if (clean.length < allStatuses.length) {
      const { writeJson } = await import("@/lib/blob");
      await writeJson("status-definitions.json", clean);
    }

    return Response.json(
      { success: true, created, updated, skipped, total: clean.length },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    console.error("Status seed error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500, headers: noCacheHeaders() });
  }
}
