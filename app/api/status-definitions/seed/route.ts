import { NextRequest } from "next/server";
import { upsertStatus, getStatusDefinitions } from "@/lib/statusData";
import { noCacheHeaders } from "@/lib/auth";
import type { StatusClassification } from "@/lib/types";

interface SeedEntry {
  code: string;
  channelId: string;
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

    let created = 0;
    let updated = 0;
    for (const s of statuses) {
      const { isNew } = await upsertStatus({
        code: s.code,
        channelId: s.channelId,
        classification: s.classification,
        description: s.description,
        notes: s.notes,
      });
      if (isNew) created++;
      else updated++;
    }

    const total = await getStatusDefinitions();
    return Response.json(
      { success: true, created, updated, total: total.length },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    console.error("Status seed error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500, headers: noCacheHeaders() });
  }
}
