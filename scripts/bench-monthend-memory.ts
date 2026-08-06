/* Benchmark: what actually costs the memory in the Month-End workbook?

   The Month-End report OOMs building the exceljs workbook (TOPLINE, 87,854
   ledger rows). Two candidate causes, and they call for very different fixes:

     1. exceljs holding a cell object per cell — only streaming fixes that, and
        streaming can't embed the Menu logos (WorksheetWriter has no addImage).
     2. The builder allocating a FRESH font + border object for every single
        cell. `thinBorder()` alone builds 5 objects per call. Every one of them
        dedupes to a handful of distinct styles at write time, so they are pure
        waste — and sharing them is a few lines with no feature loss.

   This builds a TOPLINE-sized detail grid three ways and reports peak heap, so
   the fix is chosen on measurement rather than assumption.

   Run: npx tsx --expose-gc scripts/bench-monthend-memory.ts */

import ExcelJS from "exceljs";

const ROWS = Number(process.env.ROWS ?? 87854);   // TOPLINE's ledger size
const COLS = 45;                                  // Data sheet width

const BORDER_COLOR = "B4C6E7";
const HEADER_BG = "1F4E79";

// ── The two styling strategies ──────────────────────────────────

// What the builder does today: a new object graph per cell.
function freshBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: BORDER_COLOR } };
  return { top: side, bottom: side, left: side, right: side };
}
function freshFont(bold = false): Partial<ExcelJS.Font> {
  return { name: "Calibri", size: 10, bold };
}

// Shared, frozen singletons. exceljs stores the reference and serialises it at
// write time; freezing proves nothing downstream mutates them (a mutation would
// throw loudly here rather than silently corrupting every cell in the sheet).
const SHARED_BORDER = Object.freeze({
  top: Object.freeze({ style: "thin", color: Object.freeze({ argb: BORDER_COLOR }) }),
  bottom: Object.freeze({ style: "thin", color: Object.freeze({ argb: BORDER_COLOR }) }),
  left: Object.freeze({ style: "thin", color: Object.freeze({ argb: BORDER_COLOR }) }),
  right: Object.freeze({ style: "thin", color: Object.freeze({ argb: BORDER_COLOR }) }),
}) as Partial<ExcelJS.Borders>;
const SHARED_FONT = Object.freeze({ name: "Calibri", size: 10, bold: false }) as Partial<ExcelJS.Font>;

function mb(bytes: number) { return (bytes / 1048576).toFixed(0); }

/* NOTE: an interval-based sampler is useless for the build loop — the loop is
   synchronous, so the event loop never turns and the timer never fires. Build
   cost is therefore measured synchronously (retained heap once the sheet is
   fully populated); only the async write phase is sampled. */
function peakTracker() {
  let peak = 0;
  const t = setInterval(() => {
    const u = process.memoryUsage().heapUsed;
    if (u > peak) peak = u;
  }, 25);
  return { stop: () => { clearInterval(t); return peak; } };
}

function heapNow() { global.gc?.(); return process.memoryUsage().heapUsed; }

async function build(label: string, mode: "fresh" | "shared" | "nostyle") {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const tracker = peakTracker();
  const t0 = Date.now();

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Data");

  // Header row (identical in all three modes)
  for (let c = 1; c <= COLS; c++) {
    const cell = sheet.getCell(1, c);
    cell.value = `Col ${c}`;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  }

  for (let r = 2; r <= ROWS + 1; r++) {
    for (let c = 1; c <= COLS; c++) {
      const cell = sheet.getCell(r, c);
      cell.value = c % 3 === 0 ? r * c : `v${r}-${c}`;
      if (mode === "fresh") {
        cell.font = freshFont();
        cell.border = freshBorder();
      } else if (mode === "shared") {
        cell.font = SHARED_FONT;
        cell.border = SHARED_BORDER;
      }
      if (c % 3 === 0) cell.numFmt = "#,##0";
    }
  }

  tracker.stop();
  const buildMs = Date.now() - t0;
  // Synchronous: what the populated sheet actually retains before any writing.
  const retained = process.memoryUsage().heapUsed - before;

  const t1 = Date.now();
  const tracker2 = peakTracker();
  let bytes = 0;
  let failed = "";
  try {
    const buf = await wb.xlsx.writeBuffer();
    bytes = (buf as ArrayBuffer).byteLength;
  } catch (e) {
    failed = String(e).slice(0, 60);
  }
  const writePeak = tracker2.stop();
  const writeMs = Date.now() - t1;

  console.log(
    `  ${label.padEnd(26)} build ${String(buildMs).padStart(6)}ms  ` +
    `retained ${mb(retained).padStart(5)}MB  ` +
    `PEAK ${mb(writePeak).padStart(5)}MB  ` +
    `write ${String(writeMs).padStart(6)}ms  out ${mb(bytes)}MB` +
    (failed ? `  ** ${failed}` : ""),
  );

  global.gc?.();
}

/* The streaming equivalent: same grid, same styling, but each row is committed
   and freed as it is written. Nothing accumulates, so peak should stay flat and
   independent of row count — which is the whole point. */
async function buildStreaming(label: string, styles: "shared" | "fresh" = "shared") {
  const { PassThrough } = await import("node:stream");
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  const tracker = peakTracker();

  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => {
    stream.on("end", () => res(Buffer.concat(chunks)));
    stream.on("error", rej);
  });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream, useStyles: true, useSharedStrings: true,
  });
  const sheet = wb.addWorksheet("Data");

  const hdr = sheet.getRow(1);
  for (let c = 1; c <= COLS; c++) {
    const cell = hdr.getCell(c);
    cell.value = `Col ${c}`;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  }
  hdr.commit();

  for (let r = 2; r <= ROWS + 1; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= COLS; c++) {
      const cell = row.getCell(c);
      cell.value = c % 3 === 0 ? r * c : `v${r}-${c}`;
      // "fresh" mirrors what the real builder does today (a new font + border
      // object per cell). Under streaming those become garbage the moment the
      // row commits, so peak should stay bounded even without sharing them —
      // which is what this mode is here to prove.
      cell.font = styles === "shared" ? SHARED_FONT : freshFont();
      cell.border = styles === "shared" ? SHARED_BORDER : freshBorder();
      if (c % 3 === 0) cell.numFmt = "#,##0";
    }
    row.commit();   // ← written out and freed
  }
  await sheet.commit();
  await wb.commit();
  const buf = await done;

  const peak = tracker.stop();
  console.log(
    `  ${label.padEnd(26)} build ${String(Date.now() - t0).padStart(6)}ms  ` +
    `retained ${"-".padStart(5)}    ` +
    `PEAK ${mb(Math.max(peak - before, 0)).padStart(5)}MB  ` +
    `write ${"-".padStart(6)}       out ${mb(buf.length)}MB`,
  );
  global.gc?.();
}

async function main() {
  console.log(`\nMonth-End memory benchmark — ${ROWS.toLocaleString()} rows x ${COLS} cols ` +
    `(~${((ROWS * COLS) / 1e6).toFixed(1)}M cells)`);
  console.log(`Node ${process.version}, heap limit ~${mb(require("v8").getHeapStatistics().heap_size_limit)}MB\n`);

  if (!global.gc) console.log("  (run with --expose-gc for cleaner numbers)\n");

  // ONLY=streaming lets the full 87k run happen without the non-streaming
  // modes OOMing the process first (which would kill it before streaming ran).
  const only = process.env.ONLY;
  if (!only) {
    await build("no cell styling", "nostyle");
    await build("SHARED font+border", "shared");
    await build("FRESH per cell (today)", "fresh");
  }
  await buildStreaming("STREAMING + shared", "shared");
  await buildStreaming("STREAMING + fresh (real)", "fresh");

  console.log("");
}

main().catch((e) => { console.error("BENCH FAILED:", e); process.exit(1); });
