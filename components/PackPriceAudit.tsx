"use client";

/* Pack prices sitting in last year's value columns.

   DISPO loads before 30 Jun 2026 folded a SKU's per-UOM rows onto one ledger
   key, so the CASE price won and got snapshotted as that year's price. The live
   price columns heal on the next DISPO load; the per-year snapshots never do.
   Full write-up in lib/priceSnapshotRepair.ts.

   Declared at module level on purpose — a component defined inside another
   component is a new type every render and remounts, which would blow away the
   scan result on every keystroke. */

import { useState } from "react";
import { authFetch } from "@/lib/useAuth";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";

interface LedgerRow {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  rows: number;
  rowsRepaired: number;
  fieldsRemoved: number;
  byField: Record<string, number>;
  liveSuspectRows: number;
  liveSuspectUnits: number;
  unknownRows: number;
  unknownUnits: number;
  snapshotRows: number;
  error?: string;
}
interface Report {
  mode: "preview" | "applied";
  seconds: number;
  totals: {
    ledgers: number; failed: number; rows: number;
    rowsRepaired: number; fieldsRemoved: number;
    liveSuspectRows: number; liveSuspectUnits: number;
    unknownRows: number; unknownUnits: number; snapshotRows: number;
  };
  ledgers: LedgerRow[];
}

export default function PackPriceAudit({ canRepair }: { canRepair: boolean }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"" | "scan" | "repair">("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function run(mode: "scan" | "repair") {
    setBusy(mode);
    setError("");
    setConfirming(false);
    try {
      const res = await authFetch(
        mode === "scan" ? "/api/admin/price-snapshots" : "/api/admin/price-snapshots?confirm=repair",
        mode === "scan" ? undefined : { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok) setReport(body);
      else setError(body.error || `${mode === "scan" ? "Scan" : "Repair"} failed (${res.status})`);
    } catch {
      setError("Network error");
    }
    setBusy("");
  }

  const tools = useTableTools<LedgerRow>(
    report?.ledgers ?? [],
    {
      clientName: (l) => l.clientName,
      channelName: (l) => l.channelName,
      fieldsRemoved: (l) => l.fieldsRemoved,
      snapshotRows: (l) => l.snapshotRows,
      liveSuspectRows: (l) => l.liveSuspectRows,
    },
    "fieldsRemoved",
    (l) => [l.clientName, l.channelName, Object.keys(l.byField).join(" ")].join(" "),
    "desc",
  );

  const t = report?.totals;
  const applied = report?.mode === "applied";

  return (
    <section className="mt-12 border-t border-[var(--color-border)] pt-8">
      <h2 className="mb-2 text-xl font-bold text-[var(--color-text)]">
        Pack prices in last year&apos;s values
      </h2>
      <p className="mb-6 max-w-3xl text-sm text-[var(--color-text-muted)]">
        A Makro DISPO lists each product once per unit of measure — each, case, layer, pallet — and
        only the <em>each</em> row carries sales. DISPO loads before <strong>30 June 2026</strong> kept
        the <strong>case</strong> price by mistake and stored it as that year&apos;s price, so
        &ldquo;Same Month LY&rdquo; and &ldquo;LY YTD&rdquo; Rands read up to 25× too high. Verigreen&apos;s
        August report showed <strong>R13.9m</strong> where the DISPO supports <strong>R775k</strong>.
        Unit counts were never affected.
      </p>
      <p className="mb-4 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Repairing removes the bad stored price so the report falls back to the product&apos;s current
        price — out by inflation instead of by a factor of 25. It never touches sales, stock or the
        current price columns, and running it twice does nothing the second time.
      </p>
      <p className="mb-6 max-w-3xl rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <strong>Order matters.</strong> Load a client&apos;s latest DISPO <em>first</em>, then run this.
        A stored price is judged against the product&apos;s current price, so if the current price is
        itself still a pack price the two look alike and the bad one is left in place. Re-run this
        after any batch of loads.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => run("scan")}
          disabled={busy !== ""}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
        >
          {busy === "scan" ? "Checking every ledger…" : "Check for pack prices"}
        </button>

        {canRepair && report && !applied && t && t.fieldsRemoved > 0 && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy !== ""}
            className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            Repair {t.fieldsRemoved.toLocaleString()} stored price{t.fieldsRemoved === 1 ? "" : "s"}…
          </button>
        )}
      </div>

      {confirming && t && (
        <div className="mt-4 max-w-2xl rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-bold text-amber-900">
            Remove {t.fieldsRemoved.toLocaleString()} stored price{t.fieldsRemoved === 1 ? "" : "s"} from{" "}
            {t.rowsRepaired.toLocaleString()} row{t.rowsRepaired === 1 ? "" : "s"}?
          </div>
          <p className="mt-1 text-sm text-amber-800">
            This edits the sales ledgers directly and cannot be undone from here. Sales, stock and
            current prices are not touched. Nobody can load a DISPO while it runs.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => run("repair")}
              disabled={busy !== ""}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy === "repair" ? "Repairing…" : "Yes, repair them"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {report && t && (
        <div className="mt-6">
          {t.fieldsRemoved === 0 && t.liveSuspectRows === 0 && t.failed === 0 ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-700">
              ✓ No pack prices found in any ledger. Last year&apos;s values are sound.
            </div>
          ) : (
            <>
              <div
                className={`mb-4 rounded-xl border p-4 ${
                  applied ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"
                }`}
              >
                <div className={`text-sm font-bold ${applied ? "text-green-800" : "text-amber-900"}`}>
                  {applied
                    ? `Repaired — ${t.fieldsRemoved.toLocaleString()} stored price(s) removed from ${t.rowsRepaired.toLocaleString()} row(s)`
                    : `${t.fieldsRemoved.toLocaleString()} stored price(s) on ${t.rowsRepaired.toLocaleString()} row(s) are pack prices`}
                </div>
                <div className={`mt-1 text-sm ${applied ? "text-green-700" : "text-amber-800"}`}>
                  Across {t.ledgers.toLocaleString()} ledger(s), {t.rows.toLocaleString()} row(s) read in{" "}
                  {report.seconds}s — {t.snapshotRows.toLocaleString()} of them carry a stored price at all.
                  {t.failed > 0 && ` ${t.failed} ledger(s) could not be read — see the table.`}
                </div>
                {t.liveSuspectRows > 0 && (
                  <div className="mt-2 text-sm text-amber-800">
                    <strong>{t.liveSuspectRows.toLocaleString()} row(s)</strong> still hold a pack price as
                    their <em>current</em> price, carrying{" "}
                    <strong>{Math.round(t.liveSuspectUnits).toLocaleString()} units</strong> of sales. This
                    sweep deliberately leaves those alone — they clear when that client&apos;s latest DISPO
                    is re-uploaded in Data Load. Run this again afterwards.
                  </div>
                )}
                {t.unknownRows > 0 && (
                  <div className="mt-2 text-sm text-amber-800">
                    {t.unknownRows.toLocaleString()} row(s) have a stored price but no current price to
                    judge it against, so they were left untouched rather than guessed at. Between them they
                    carry <strong>{Math.round(t.unknownUnits).toLocaleString()} units</strong> of sales in
                    the years those prices cover
                    {t.unknownUnits < 1 ? " — so they change nothing in any report." : "."}
                  </div>
                )}
              </div>

              <div className="mb-3">
                <TableSearch
                  value={tools.query}
                  onChange={tools.setQuery}
                  count={tools.rows.length}
                  total={tools.total}
                  placeholder="Search clients, channels…"
                />
              </div>
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                    <tr>
                      {[["Client", "clientName"], ["Channel", "channelName"]].map(([label, key]) => (
                        <SortableTh key={key} label={label} sortKey={key} className="px-4 py-2.5"
                          current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      ))}
                      <SortableTh label={applied ? "Prices removed" : "Pack prices"} sortKey="fieldsRemoved"
                        className="px-4 py-2.5" align="right"
                        current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      <SortableTh label="Needs re-upload" sortKey="liveSuspectRows"
                        className="px-4 py-2.5" align="right"
                        current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      <SortableTh label="Has stored prices" sortKey="snapshotRows"
                        className="px-4 py-2.5" align="right"
                        current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      <th className="px-4 py-2.5 text-left font-semibold">Years affected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {tools.rows.map((l) => (
                      <tr key={`${l.clientId}-${l.channelId}`} className="align-top hover:bg-zinc-50/50">
                        <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{l.clientName}</td>
                        <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{l.channelName}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`font-semibold ${applied ? "text-green-600" : "text-red-600"}`}>
                            {l.fieldsRemoved.toLocaleString()}
                          </span>
                          <span className="text-[var(--color-text-muted)]"> / {l.rows.toLocaleString()} rows</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
                          {l.liveSuspectRows > 0 ? l.liveSuspectRows.toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
                          {l.snapshotRows.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {l.error
                            ? <span className="text-red-600">Could not read: {l.error}</span>
                            : Object.entries(l.byField)
                                .map(([f, n]) => `${f.replace(/^_/, "").replace(/_/, " ")} × ${n}`)
                                .join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {applied && (
                <p className="mt-3 text-sm font-medium text-[var(--color-text)]">
                  Re-run any Month-End or Vital Signs report now — last year&apos;s Rands will have changed.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
