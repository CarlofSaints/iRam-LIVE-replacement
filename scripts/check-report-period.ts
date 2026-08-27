/* Why does the Reports page show an OLD week on Auto?

   "Auto" is not a search of the data — it is the period STAMP on each
   client x channel sales-ledger meta, and `mergeDispo` writes that stamp
   unconditionally:

       reportWeek: reportWeek ?? existingMeta?.reportWeek

   So the LAST load wins, not the LATEST period. Reload a Wk3 file after a
   Wk5 file and the ledger's stamp walks BACKWARDS to Wk3 — even though the
   snapshot fields it carries are correctly rejected as stale.

   This prints, per channel: the stamp the ledger holds now, every DISPO load
   for that channel in UPLOAD order (so a backwards step is visible), and the
   period Reports would resolve on Auto.

   Usage (PowerShell):
     $env:IRAM_EMAIL="you@iram.co.za"; $env:IRAM_PASSWORD="…"
     npx tsx scripts/check-report-period.ts "MAJOR TECH" "VERMONT"
   No names = every client.                                                  */

import { appUrl, login, getDispoUploads, type Upload } from "./appClient";

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const score = (y?: number, m?: number, w?: number) => (y ?? 0) * 10000 + (m ?? 0) * 100 + (w ?? 0);
const label = (y?: number, m?: number, w?: number) =>
  y ? `${MON[m ?? 0] ?? m} ${y} Wk${w ?? "?"}` : "(unstamped)";

const argv = process.argv.slice(2);
const wanted = argv.filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());

interface Meta {
  clientId: string; clientName: string; channelId: string; channelName: string;
  totalRows?: number; dateColumns?: string[];
  reportYear?: number; reportMonth?: number; reportWeek?: number; lastMergedAt?: string;
}

async function main() {
  const app = appUrl();
  const cookie = await login(app);

  const clientsRes = await fetch(`${app}/api/clients`, { headers: { cookie } });
  const clients = (await clientsRes.json()) as { id: string; name: string }[];
  const targets = clients.filter(
    (c) => wanted.length === 0 || wanted.some((w) => c.name.toUpperCase().includes(w)),
  );
  if (targets.length === 0) {
    console.error(`No client matched ${wanted.join(", ")}. Have: ${clients.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }

  const uploads = await getDispoUploads(app, cookie);

  for (const client of targets) {
    const res = await fetch(`${app}/api/sales?clientId=${client.id}`, { headers: { cookie } });
    const metas = (await res.json()) as Meta[];

    console.log(`\n${"=".repeat(72)}\n${client.name}\n${"=".repeat(72)}`);

    // What Reports resolves on Auto = the LATEST stamp across the ledgers in scope.
    let best: Meta | null = null;
    for (const m of metas) {
      if (!m.reportYear) continue;
      if (!best || score(m.reportYear, m.reportMonth, m.reportWeek) > score(best.reportYear, best.reportMonth, best.reportWeek)) best = m;
    }
    console.log(`Auto (whole client) resolves to: ${label(best?.reportYear, best?.reportMonth, best?.reportWeek)}`
      + (best ? `   [from the ${best.channelName} ledger]` : ""));

    for (const m of metas) {
      const mine = uploads
        .filter((u) => u.clientId === client.id && u.channelId === m.channelId)
        .sort((a, b) => (a.uploadDate ?? "").localeCompare(b.uploadDate ?? ""));

      const newest = mine.reduce<Upload | null>(
        (acc, u) => (!acc || score(u.reportYear, u.reportMonth, u.reportWeek) > score(acc.reportYear, acc.reportMonth, acc.reportWeek) ? u : acc),
        null,
      );
      const lastLoaded = mine[mine.length - 1];

      const stamp = label(m.reportYear, m.reportMonth, m.reportWeek);
      const behind = newest && score(m.reportYear, m.reportMonth, m.reportWeek) < score(newest.reportYear, newest.reportMonth, newest.reportWeek);

      console.log(`\n  ── ${m.channelName} ──`);
      console.log(`     ledger stamp     : ${stamp}${behind ? "   <<< BEHIND the newest DISPO loaded" : ""}`);
      console.log(`     newest DISPO here: ${newest ? label(newest.reportYear, newest.reportMonth, newest.reportWeek) : "(none)"}`);
      console.log(`     last one LOADED  : ${lastLoaded ? `${label(lastLoaded.reportYear, lastLoaded.reportMonth, lastLoaded.reportWeek)}  on ${(lastLoaded.uploadDate ?? "").slice(0, 16).replace("T", " ")}` : "(none)"}`);
      console.log(`     ledger rows      : ${m.totalRows ?? "?"}   months: ${(m.dateColumns ?? []).join(", ") || "(none)"}`);

      if (mine.length) {
        console.log(`     loads in upload order:`);
        let prev = 0;
        for (const u of mine) {
          const s = score(u.reportYear, u.reportMonth, u.reportWeek);
          const step = prev && s < prev ? "  ↓ went backwards" : "";
          console.log(`       ${(u.uploadDate ?? "").slice(0, 16).replace("T", " ")}  ${label(u.reportYear, u.reportMonth, u.reportWeek).padEnd(14)} ${String((u.dateColumns ?? []).length).padStart(2)} months  ${u.fileName}${step}`);
          prev = s;
        }
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
