import { apartmentExportRows, type ApartmentRow } from "./apartment-reader";

export async function exportApartments(rows: ApartmentRow[], period: string, kind: "pdf" | "xlsx") {
  const body = apartmentExportRows(rows);
  if (kind === "xlsx") {
    const XLSX = await import("xlsx"); const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["RELAÇÃO DE UHs — SERVIÇOS"], [period], ["UNIDADE", "VALOR"], ...body.map(([uh, value]) => [uh, `R$ ${value}`])]);
    sheet["!cols"] = [{ wch: 24 }, { wch: 24 }]; XLSX.utils.book_append_sheet(book, sheet, "Relação de UHs");
    return new Blob([XLSX.write(book, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const { jsPDF } = await import("jspdf"); const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF(); doc.setFontSize(16); doc.text("RELAÇÃO DE UHs — SERVIÇOS", 14, 18);
  doc.setFontSize(10); doc.text("Relação de apartamentos e respectivos valores individuais.", 14, 26);
  if (period) doc.text(doc.splitTextToSize(period, 180), 14, 34);
  autoTable(doc, { head: [["UNIDADE", "VALOR"]], body: body.map(([uh, value]) => [uh, `R$ ${value}`]), startY: period ? 46 : 36, margin: { bottom: 20 }, styles: { fontSize: 11 }, headStyles: { fillColor: [20, 120, 150] }, columnStyles: { 1: { halign: "right" } } });
  for (let i = 1; i <= doc.getNumberOfPages(); i++) { doc.setPage(i); doc.setFontSize(9); doc.text(`${body.length} unidades · Página ${i} de ${doc.getNumberOfPages()}`, 14, 287); }
  return doc.output("blob");
}
export async function deliverApartmentFile(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (error) { if ((error as DOMException).name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}