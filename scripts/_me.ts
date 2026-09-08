import ExcelJS from "exceljs";
const F = "C:/Users/CarlDosSantos-(OUTER/eXceler8/OuterJoin - Clients/IRAM/ARIA/04_Operations/Projects/iRam LIVE Replacement/ME bug/Month End - SNOMASTER (PTY) LTD - 9321 - 202608Wk4 (7).xlsx";
const txt = (v: unknown) => {
  if (v && typeof v === "object" && "formula" in (v as object)) return "=" + (v as {formula:string}).formula;
  if (v && typeof v === "object" && "result" in (v as object)) return String((v as {result:unknown}).result);
  return String(v ?? "");
};
async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(F);
  const sales = wb.getWorksheet("Sales")!;
  console.log("=== Sales rows 1-14 ===");
  for (let r = 1; r <= 14; r++) {
    const vals: string[] = [];
    for (let c = 1; c <= 12; c++) vals.push(txt(sales.getCell(r, c).value));
    if (vals.some(v => v)) console.log(r, vals.filter(Boolean).join(" | ").slice(0, 220));
  }
  const data = wb.getWorksheet("Data")!;
  const hdr: string[] = [];
  for (let c = 1; c <= data.columnCount; c++) hdr.push(txt(data.getCell(1, c).value));
  console.log("\n=== Data headers ===\n", hdr.join(" | "));
  console.log("\n=== Menu rows 1-16 ===");
  const menu = wb.getWorksheet("Menu")!;
  for (let r = 1; r <= 16; r++) {
    const vals: string[] = [];
    for (let c = 1; c <= 6; c++) vals.push(txt(menu.getCell(r, c).value));
    if (vals.some(v => v)) console.log(r, [...new Set(vals.filter(Boolean))].join(" | ").slice(0, 200));
  }
}
main();
