import { expect, test } from "bun:test";
import { apartmentExportRows, apartmentFilename, consolidateApartments, extractApartmentRows, type ApartmentRow, type OcrWord } from "../src/lib/apartment-reader";
import { greenBands } from "../src/lib/apartment-reader-ocr";
const row = (uh: string, value: string, id = uh): ApartmentRow => ({ id, uh, value, source: "documento.pdf", page: 1, confidence: 95, reason: "", reviewed: false });
test("64 UHs plus 37 overlapping UHs remains 64 unique units, never summed", () => {
  const first = Array.from({ length: 64 }, (_, i) => row(String(i + 21), "4.421,01"));
  const repeated = first.slice(0, 37).map(r => ({ ...r, id: r.id + "b" }));
  const result = consolidateApartments([...first, ...repeated]);
  expect(result.unique).toBe(64); expect(result.duplicates).toBe(37); expect(apartmentExportRows([...first, ...repeated])).toHaveLength(64);
});
test("same UH with different values flags divergence and blocks export", () => {
  const rows = [row("525", "4.421,01"), row("UH525", "4.009,61", "other")];
  expect(consolidateApartments(rows).units[0].conflict).toBe(true); expect(() => apartmentExportRows(rows)).toThrow();
});
test("unreadable amounts and missing UHs remain pending rather than zero", () => {
  expect(consolidateApartments([row("525", ""), row("", "4.009,61")]).pending).toBe(2);
});
test("different UHs with identical amounts are preserved", () => {
  expect(apartmentExportRows([row("525", "4.421,01"), row("524", "4.421,01")])).toHaveLength(2);
});
test("manual correction resolves conflict without touching original rows", () => {
  const original = [row("525", "4.421,01"), row("525", "4.009,61", "b")];
  const fixed = original.map(r => r.id === "b" ? { ...r, value: "4.421,01", reviewed: true } : r);
  expect(apartmentExportRows(fixed)).toEqual([["UH525", "4.421,01"]]); expect(original[1].value).toBe("4.009,61");
});
const word = (text: string, x: number, y: number, confidence = 95): OcrWord => ({ text, confidence, bbox: { x0: x, y0: y, x1: x + 75, y1: y + 15 } });
test("extracts only highlighted TOTAL DE DESPESAS paired to its UH, not payments", () => {
  const words = [word("UH525", 0, 0), word("Créditos", 0, 20), word("9.000,00", 120, 20), word("TOTAL", 0, 40), word("DE", 80, 40), word("DESPESAS", 160, 40), word("4.421,01", 260, 40), word("UH524", 0, 80), word("TOTAL", 0, 100), word("DE", 80, 100), word("DESPESAS", 160, 100), word("4.009,61", 260, 100)];
  const rows = extractApartmentRows(words, [{ x0: 250, x1: 350, y0: 35, y1: 58 }], "real.pdf", 2);
  expect(rows[0].uh).toBe("525"); expect(rows[0].value).toBe("4.421,01"); expect(rows[0].page).toBe(2); expect(rows[1].value).toBe("");
});
test("a highlighted credit without expense label is not a total", () => {
  const rows = extractApartmentRows([word("UH301", 0, 0), word("Créditos", 0, 20), word("7.252,62", 120, 20)], [{ x0: 110, x1: 220, y0: 18, y1: 40 }], "photo.jpg", 1);
  expect(rows[0].value).toBe(""); expect(consolidateApartments(rows).pending).toBe(1);
});
test("detects fluorescent green but not plain white or blue", () => {
  const data = new Uint8ClampedArray(100 * 20 * 4).fill(255);
  for (let y = 5; y < 12; y++) for (let x = 20; x < 80; x++) { const i = (y * 100 + x) * 4; data[i] = 125; data[i + 1] = 240; data[i + 2] = 60; }
  expect(greenBands({ data, width: 100, height: 20 })).toEqual([{ x0: 20, x1: 80, y0: 5, y1: 12 }]);
});
test("period names consolidate into the requested filename", () => {
  expect(apartmentFilename("30 OUTUBRO A 02 NOVEMBRO", "pdf")).toBe("RELACAO_DE_UHS_30_OUTUBRO_A_02_NOVEMBRO.pdf");
});