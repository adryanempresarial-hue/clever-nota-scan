import { calculateTotals, calculatedRowTotal, displayCents, resultHeaders, rowPayments, readingStatus, possibleDuplicates } from "./fiscal-reader";
import type { PaymentRow } from "./fiscal-reader";
import type { FiscalRun } from "./fiscal-reader-store";
export function fiscalExportRows(rows: PaymentRow[]) {
  const duplicates = possibleDuplicates(rows);
  return rows.map((r, i) => [r.page ?? "", r.uh, r.comp ?? "", r.guest, r.credit, rowPayments(r).map(p => `${p.brand || "Não identificado"}: ${p.amount || "Não lido"}`).join("; "), calculatedRowTotal(r) === null ? "" : displayCents(calculatedRowTotal(r) ?? 0), [readingStatus(r), ...(duplicates.includes(i) ? ["Possível duplicidade"] : [])].join("; "), r.cpf, r.source]);
}
export function fiscalCopyText(rows: PaymentRow[]) {
  return [[...resultHeaders, "CPF", "Arquivo de origem"], ...fiscalExportRows(rows)].map(values => values.map(v => String(v).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}
export async function exportFiscalRun(run: FiscalRun, rows: PaymentRow[], kind: "xlsx" | "pdf"): Promise<Blob> {
  const headers = [...resultHeaders, "CPF", "Arquivo de origem"];
  const totals = calculateTotals(rows).map(t => [t.uh, t.guest, displayCents(t.paymentsCents), displayCents(t.creditsCents), displayCents(t.paymentsCents + t.creditsCents)]);
  if (kind === "xlsx") {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    for (const [name, matrix] of [["Resultados", [headers, ...fiscalExportRows(rows)]], ["Originais", [headers, ...fiscalExportRows(run.extracted_rows)]], ["Totais", [["UH", "Hóspede", "Pagamentos", "Créditos", "Total calculado"], ...totals]], ["Conferência", [["Documento", run.file_name], ["Situação", run.status === "confirmed" ? "Confirmado" : "Pendente"], ...run.warnings.map(w => [w])]]] as [string, unknown[][]][]) {
      const sheet = XLSX.utils.aoa_to_sheet(matrix); sheet["!cols"] = matrix[0]?.map(() => ({ wch: 24 })); XLSX.utils.book_append_sheet(book, sheet, name);
    }
    return new Blob([XLSX.write(book, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14); doc.text("Leitor Inteligente de Documentos", 14, 16);
  doc.setFontSize(9); doc.text(doc.splitTextToSize(`${run.file_name} · ${run.status === "confirmed" ? "Confirmado" : "Pendente de conferência"}`, 265), 14, 24);
  autoTable(doc, { startY: 34, head: [headers], body: fiscalExportRows(rows), styles: { fontSize: 8 }, margin: 14 });
  doc.addPage(); doc.text("Totais por UH e hóspede (valores legíveis)", 14, 16);
  autoTable(doc, { startY: 24, head: [["UH", "Hóspede", "Pagamentos", "Créditos", "Total calculado"]], body: totals });
  if (run.warnings.length) { doc.addPage(); doc.text("Pendências do documento", 14, 16); autoTable(doc, { startY: 24, body: run.warnings.map(w => [w]) }); }
  doc.addPage(); doc.text("Dados extraídos originais", 14, 16); autoTable(doc, { startY: 24, head: [headers], body: fiscalExportRows(run.extracted_rows), styles: { fontSize: 8 } });
  return doc.output("blob");
}
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function copyFiscalText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* browser fallback */ }
  const area = document.createElement("textarea"); area.value = text; area.className = "fixed opacity-0"; document.body.append(area); area.select(); const ok = document.execCommand("copy"); area.remove(); if (!ok) throw new Error("Não foi possível copiar.");
}