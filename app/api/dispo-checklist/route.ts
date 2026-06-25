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
  vendorNumber: string;
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

    // Index loads by client|vendor|period → latest date + count (within the window).
    const cellIndex = new Map<string, Cell>();
    for (const u of dispos) {
      const pk = periodKey(u.reportYear!, u.reportMonth!, u.reportWeek!);
      if (!periodKeys.has(pk)) continue;
      const vendor = (u.vendorNumber || "").trim();
      const ck = `${u.clientId}|${vendor}|${pk}`;
      const existing = cellIndex.get(ck);
      if (!existing) {
        cellIndex.set(ck, { loaded: true, date: u.uploadDate, count: 1 });
      } else {
        existing.count = (existing.count ?? 1) + 1;
        // keep the most recent load date
        if (u.uploadDate > (existing.date ?? "")) existing.date = u.uploadDate;
      }
    }

    // One row per (client, vendor number). Clients with no vendor numbers get a
    // single placeholder row so they still appear in the checklist.
    const rows: ChecklistRow[] = [];
    const sortedClients = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of sortedClients) {
      const vendors = c.vendorNumbers.length > 0 ? c.vendorNumbers.map((v) => v.trim()).filter(Boolean) : [""];
      for (const vendor of vendors) {
        const cells: Record<string, Cell> = {};
        for (const p of periods) {
          cells[p.key] = cellIndex.get(`${c.id}|${vendor}|${p.key}`) ?? { loaded: false };
        }
        rows.push({
          clientId: c.id,
          clientName: c.name,
          active: c.active,
          vendorNumber: vendor,
          cells,
        });
      }
    }

    // Per-period outstanding counts (rows with no load) for the summary strip.
    const outstanding: Record<string, number> = {};
    for (const p of periods) {
      outstanding[p.key] = rows.filter((r) => !r.cells[p.key]?.loaded).length;
    }

    return Response.json(
      { periods, rows, outstanding, totalRows: rows.length },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
