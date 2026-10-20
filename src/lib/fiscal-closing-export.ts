import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { calculatedRowTotal } from "./fiscal-reader";
import type { PaymentRow } from "./fiscal-reader";

// Fills the user's "Fechamento Verdes Vales" template (public/templates) keeping its formulas and styles.
const FIRST = 9, LAST = 1008;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const closingEntries = (rows: PaymentRow[]) => rows.filter(r => !r.excluded).map(r => ({ uh: r.uh.trim(), cents: calculatedRowTotal(r) })).filter((e): e is { uh: string; cents: number } => e.cents !== null);
const excelSerial = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
export function fillClosingSheet(xml: string, entries: { uh: string; cents: number }[], isoDate: string) {
  if (entries.length > LAST - FIRST + 1) throw new Error(`O modelo aceita até ${LAST - FIRST + 1} lançamentos.`);
  const set = (ref: string, inner: (s: string) => string) => {
    const re = new RegExp(`<c r="${ref}"( s="\\d+")?[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    xml = xml.replace(re, (_m, s = "") => inner(s));
  };
  set("C4", s => `<c r="C4"${s}><v>${excelSerial(isoDate)}</v></c>`);
  for (let row = FIRST; row <= LAST; row++) {
    const e = entries[row - FIRST];
    set(`B${row}`, s => e?.uh ? `<c r="B${row}"${s} t="inlineStr"><is><t>${esc(e.uh)}</t></is></c>` : `<c r="B${row}"${s}/>`);
    set(`C${row}`, s => e ? `<c r="C${row}"${s}><v>${(e.cents / 100).toFixed(2)}</v></c>` : `<c r="C${row}"${s}/>`);
  }
  return xml;
}
export async function buildClosingWorkbook(rows: PaymentRow[], isoDate: string) {
  const res = await fetch("/templates/fechamento-verdes-vales.xlsx");
  if (!res.ok) throw new Error("Modelo de fechamento indisponível.");
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  files["xl/worksheets/sheet1.xml"] = strToU8(fillClosingSheet(strFromU8(files["xl/worksheets/sheet1.xml"]), closingEntries(rows), isoDate));
  files["xl/workbook.xml"] = strToU8(strFromU8(files["xl/workbook.xml"]).replace(/<calcPr([^/]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>'));
  delete files["xl/calcChain.xml"];
  if (files["[Content_Types].xml"]) files["[Content_Types].xml"] = strToU8(strFromU8(files["[Content_Types].xml"]).replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, ""));
  if (files["xl/_rels/workbook.xml.rels"]) files["xl/_rels/workbook.xml.rels"] = strToU8(strFromU8(files["xl/_rels/workbook.xml.rels"]).replace(/<Relationship [^>]*calcChain[^>]*\/>/, ""));
  return new Blob([zipSync(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
