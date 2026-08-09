/* ──────────────────────────────────────────────────────────────
   exceljs streaming-writer element-order fix

   THE BUG (found 9 Aug 2026 from two workbooks Sihle reported as broken):
   exceljs 4.4.0's streaming WorksheetWriter.commit() emits

       this._writeHyperlinks();
       this._writeConditionalFormatting();

   but ECMA-376's CT_Worksheet sequence requires <conditionalFormatting>
   BEFORE <hyperlinks>. Excel validates that order strictly: it declares the
   file corrupt and "repairs" it by DISCARDING the offending sheet's contents.
   The sheet still exists, still has its tab — it is simply empty. That is
   exactly the symptom reported: "the Sales and OOS sheets do not contain any
   data".

   Only sheets carrying BOTH a hyperlink and conditional formatting are hit.
   In the Month-End workbook that is precisely three: Sales, OOS and ND — the
   only three that call addColorScale() on top of the 🏠 Menu button. Every
   other sheet has one or the other, never both, which is why the rest of the
   workbook opened fine and made this look like a data problem rather than a
   file-format one.

   The NON-streaming writer orders these correctly, so this only became live
   with the 7 Aug 2026 streaming conversion (`7e6d368`). Nothing about the
   report's data changed — see [[build-verified-is-not-verified]]: the
   workbook was only ever verified by re-reading it with a parser, and every
   parser except Excel itself is order-tolerant.

   The patch swaps the emit order. It is idempotent and stays correct if
   exceljs ever fixes this upstream: hyperlinks are written at most once per
   sheet, so a future correctly-ordered commit() simply finds them already
   written and skips.
   ────────────────────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITTEN = Symbol.for("iram.hyperlinksWritten");
const CF_DONE = Symbol.for("iram.conditionalFormattingWritten");
const PATCHED = Symbol.for("iram.worksheetOrderPatched");

/**
 * Patch the WorksheetWriter class behind `sheet`.
 *
 * Takes a live worksheet rather than importing the class, deliberately: a deep
 * `require("exceljs/lib/stream/xlsx/worksheet-writer")` can resolve to a
 * different module instance once a bundler gets involved, which would patch a
 * class nobody uses and silently put us back to shipping blank sheets. The
 * prototype of a sheet exceljs just handed us is by definition the right one.
 *
 * Call once, on the first sheet created and before anything is committed.
 */
export function applyStreamWriterOrderFix(sheet: unknown): void {
  const proto = sheet ? Object.getPrototypeOf(sheet) : null;
  if (!proto || proto[PATCHED]) return;

  const writeHyperlinks = proto._writeHyperlinks;
  const writeConditionalFormatting = proto._writeConditionalFormatting;

  /* Fail loudly rather than silently shipping workbooks Excel will blank.
     An undiagnosable failure is what made this bug cost a week — if exceljs's
     internals ever move, we want a named error, not another empty sheet. */
  if (typeof writeHyperlinks !== "function" || typeof writeConditionalFormatting !== "function") {
    throw new Error(
      "exceljs stream writer internals changed: _writeHyperlinks / " +
        "_writeConditionalFormatting not found. The worksheet element-order fix " +
        "is not applied, and streamed sheets that have both a hyperlink and " +
        "conditional formatting would open EMPTY in Excel.",
    );
  }

  /* commit() calls _writeHyperlinks() BEFORE _writeConditionalFormatting(), so
     the hyperlink write is deferred rather than de-duplicated — the early call
     is what puts the element in the wrong place. It is flushed immediately
     after the conditional formatting instead.

     _writeConditionalFormatting() is called unconditionally by commit(), even
     for a sheet with no rules (it then emits nothing), so a sheet without
     conditional formatting still gets its hyperlinks. */
  proto._writeHyperlinks = function patchedWriteHyperlinks(this: any, ...args: unknown[]) {
    if (this[WRITTEN]) return undefined;
    // Conditional formatting has not been emitted yet — writing here would put
    // <hyperlinks> ahead of it. Defer; the CF pass flushes us.
    if (!this[CF_DONE]) return undefined;
    this[WRITTEN] = true;
    return writeHyperlinks.apply(this, args);
  };

  proto._writeConditionalFormatting = function patchedWriteCf(this: any, ...args: unknown[]) {
    this[CF_DONE] = true;
    const result = writeConditionalFormatting.apply(this, args);
    // Correct order: conditionalFormatting first, then hyperlinks.
    this._writeHyperlinks();
    return result;
  };

  proto[PATCHED] = true;
}
