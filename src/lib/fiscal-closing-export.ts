import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { calculatedRowTotal } from "./fiscal-reader";
import type { PaymentRow } from "./fiscal-reader";

// Fills the user's "Fechamento Verdes Vales" template (public/templates) keeping formulas and styles.
// Every formula also receives its computed value, so the file shows everything filled even in viewers that do not recalculate.
const FIRST = 9, LAST = 1008;
type Value = number | string | { input: string } | { serial: number };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const closingEntries = (rows: PaymentRow[]) => rows.filter(r => !r.excluded).map(r => ({ uh: r.uh.trim(), cents: calculatedRowTotal(r) })).filter((e): e is { uh: string; cents: number } => e.cents !== null);
const excelSerial = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const money = (cents: number) => (cents / 100).toFixed(2);

export function closingSplit(cents: number) {
  const servico = Math.round(cents * 0.3);
  const consumo = cents - servico;
  const alimentacao = Math.round(consumo * 0.3);
  return { servico, consumo, alimentacao, bebidas: consumo - alimentacao };
}

function applyCells(xml: string, cells: Map<string, Value>) {
  return xml.replace(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (match, ref: string, attrs: string, inner = "") => {
    if (!cells.has(ref)) return match;
    const value = cells.get(ref)!;
    const style = attrs.match(/ s="\d+"/)?.[0] ?? "";
    const formula = inner.match(/<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/)?.[0] ?? "";
    if (typeof value === "object" && "input" in value) return value.input ? `<c r="${ref}"${style} t="inlineStr"><is><t>${esc(value.input)}</t></is></c>` : `<c r="${ref}"${style}/>`;
    if (typeof value === "object") return `<c r="${ref}"${style}>${formula}<v>${value.serial}</v></c>`;
    if (typeof value === "number") return `<c r="${ref}"${style}>${formula}<v>${value}</v></c>`;
    return `<c r="${ref}"${style} t="str">${formula}<v>${esc(value)}</v></c>`;
  });
}

export function fillClosingSheets(launch: string, closing: string, entries: { uh: string; cents: number }[], isoDate: string) {
  if (entries.length > LAST - FIRST + 1) throw new Error(`O modelo aceita até ${LAST - FIRST + 1} lançamentos.`);
  const serial = excelSerial(isoDate);
  const a = new Map<string, Value>([["C4", { serial }]]);
  const b = new Map<string, Value>([["C4", { serial }]]);
  const sum = { c: 0, d: 0, f: 0, g: 0, h: 0 };
  for (let row = FIRST; row <= LAST; row++) {
    const e = entries[row - FIRST];
    if (!e) {
      a.set(`B${row}`, { input: "" }); a.set(`C${row}`, { input: "" });
      for (const col of "ADFGHIJ") { a.set(`${col}${row}`, ""); b.set(`${col}${row}`, ""); }
      b.set(`B${row}`, ""); b.set(`C${row}`, "");
      continue;
    }
    const s = closingSplit(e.cents);
    const status = e.uh ? "Completo" : "Falta apartamento";
    sum.c += e.cents; sum.d += s.servico; sum.f += s.alimentacao; sum.g += s.bebidas; sum.h += s.consumo;
    const item = row - FIRST + 1;
    a.set(`A${row}`, item); a.set(`B${row}`, { input: e.uh }); a.set(`C${row}`, money(e.cents) as unknown as number);
    a.set(`D${row}`, Number(money(s.servico))); a.set(`F${row}`, Number(money(s.alimentacao))); a.set(`G${row}`, Number(money(s.bebidas))); a.set(`H${row}`, Number(money(s.consumo))); a.set(`I${row}`, 0); a.set(`J${row}`, status);
    b.set(`A${row}`, item); b.set(`B${row}`, e.uh); b.set(`C${row}`, Number(money(e.cents)));
    b.set(`D${row}`, Number(money(sum.d))); b.set(`F${row}`, Number(money(sum.f))); b.set(`G${row}`, Number(money(sum.g))); b.set(`H${row}`, Number(money(sum.h))); b.set(`I${row}`, Number(money(sum.c))); b.set(`J${row}`, status);
  }
  b.set("C5", Number(money(sum.c))); b.set("D5", Number(money(sum.d))); b.set("F5", Number(money(sum.f))); b.set("G5", Number(money(sum.g))); b.set("H5", Number(money(sum.h)));
  return { launch: applyCells(launch, a), closing: applyCells(closing, b) };
}

export async function buildClosingWorkbook(rows: PaymentRow[], isoDate: string) {
  const res = await fetch("/templates/fechamento-verdes-vales.xlsx");
  if (!res.ok) throw new Error("Modelo de fechamento indisponível.");
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const out = fillClosingSheets(strFromU8(files["xl/worksheets/sheet1.xml"]), strFromU8(files["xl/worksheets/sheet2.xml"]), closingEntries(rows), isoDate);
  files["xl/worksheets/sheet1.xml"] = strToU8(out.launch);
  files["xl/worksheets/sheet2.xml"] = strToU8(out.closing);
  files["xl/workbook.xml"] = strToU8(strFromU8(files["xl/workbook.xml"]).replace(/<calcPr([^/]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>'));
  return new Blob([zipSync(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
