import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getUploadIndex } from "@/lib/uploadData";
import { getClients } from "@/lib/clientData";

export const dynamic = "force-dynamic";

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// How many of the most recent (year, month, week) periods to show as columns.
const WINDOW = 8;

interface Period { year: number; month: number; week: number; key: string; label: string }
interface Cell { loaded: boolean; date?: string; count?: number }
interface ChecklistRow {
  clientId: string;
  clientName: string;
  active: boolean;
  channelId: string;
  channelName: string;
  vendorNumber: string;
  placeholder: boolean;       // a client with no load streams discovered yet
  cells: Record<string, Cell>;
}

const periodKey = (y: number, m: number, w: number) => `${y}-${String(m).padStart(2, "0")}-${w}`;
const periodScore = (y: number, m: number, w: number) => y * 10000 + m * 100 + w;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_uploads");

    const [uploads, clients] = await Promise.all([getUploadIndex(), getClients()]);

    // Only DISPO loads that are stamped with a full period can be placed.
    const dispos = uploads.filter(
      (u) =>
        u.fileType === "dispo" &&
        u.status === "processed" &&
        u.reportYear != null &&
        u.reportMonth != null &&
        u.reportWeek != null,
    );

    // Column set = the most recent WINDOW distinct (year, month, week) periods
    // actually present across all DISPO loads (data-driven — a column appears
    // as soon as the first load for that period arrives).
    const periodMap = new Map<string, Period>();
    for (const u of dispos) {
      const y = u.reportYear!, m = u.reportMonth!, w = u.reportWeek!;
      const key = periodKey(y, m, w);
      if (!periodMap.has(key)) {
        periodMap.set(key, { year: y, month: m, week: w, key, label: `Wk${w} ${MON[m] ?? m} ${y}` });
      }
    }
    const periods = [...periodMap.values()]
      .sort((a, b) => periodScore(b.year, b.month, b.week) - periodScore(a.year, a.month, a.week))
      .slice(0, WINDOW)
      .reverse(); // chronological: oldest → newest, left → right
    const periodKeys = new Set(periods.map((p) => p.key));

    // A DISPO is loaded per (client, channel, vendor) — one vendor can span
    // channels (e.g. 2394 in Makro + Massbuild) and one channel can hold many
    // vendors (e.g. Massbuild = 2394 Tools + 5478 Lighting), so the load stream
    // is the (channel, vendor) pair, not the vendor alone.
    const streamId = (clientId: string, channelId: string, vendor: string) =>
      `${clientId}|${channelId}|${vendor}`;

    // Discover each client's real load streams from history (any period), so
    // we never invent phantom channel×vendor combos that never load.
    const streams = new Map<string, { clientId: string; channelId: string; channelName: string; vendor: string }>();
    for (const u of dispos) {
      const vendor = (u.vendorNumber || "").trim();
      const id = streamId(u.clientId, u.channelId, vendor);
      if (!streams.has(id)) {
        streams.set(id, { clientId: u.clientId, channelId: u.channelId, channelName: u.channelName, vendor });
      }
    }

    // Index loads by stream|period → latest date + count (within the window).
    const cellIndex = new Map<string, Cell>();
    for (const u of dispos) {
      const pk = periodKey(u.reportYear!, u.reportMonth!, u.reportWeek!);
      if (!periodKeys.has(pk)) continue;
      const vendor = (u.vendorNumber || "").trim();
      const ck = `${streamId(u.clientId, u.channelId, vendor)}|${pk}`;
      const existing = cellIndex.get(ck);
      if (!existing) {
        cellIndex.set(ck, { loaded: true, date: u.uploadDate, count: 1 });
      } else {
        existing.count = (existing.count ?? 1) + 1;
        if (u.uploadDate > (existing.date ?? "")) existing.date = u.uploadDate;
      }
    }

    // One row per (client, channel, vendor) stream. Every client appears — a
    // client with no discovered streams yet gets a single placeholder row.
    const rows: ChecklistRow[] = [];
    const sortedClients = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of sortedClients) {
      const clientStreams = [...streams.values()]
        .filter((s) => s.clientId === c.id)
        .sort((a, b) => a.channelName.localeCompare(b.channelName) || a.vendor.localeCompare(b.vendor));

      if (clientStreams.length === 0) {
        rows.push({
          clientId: c.id, clientName: c.name, active: c.active,
          channelId: "", channelName: "", vendorNumber: "",
          placeholder: true,
          cells: Object.fromEntries(periods.map((p) => [p.key, { loaded: false } as Cell])),
        });
        continue;
      }

      for (const s of clientStreams) {
        const cells: Record<string, Cell> = {};
        for (const p of periods) {
          cells[p.key] = cellIndex.get(`${streamId(c.id, s.channelId, s.vendor)}|${p.key}`) ?? { loaded: false };
        }
        rows.push({
          clientId: c.id, clientName: c.name, active: c.active,
          channelId: s.channelId, channelName: s.channelName, vendorNumber: s.vendor,
          placeholder: false,
          cells,
        });
      }
    }

    // Per-period outstanding counts — only real streams (placeholders excluded).
    const outstanding: Record<string, number> = {};
    const streamRows = rows.filter((r) => !r.placeholder);
    for (const p of periods) {
      outstanding[p.key] = streamRows.filter((r) => !r.cells[p.key]?.loaded).length;
    }

    return Response.json(
      { periods, rows, outstanding, totalStreams: streamRows.length },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
