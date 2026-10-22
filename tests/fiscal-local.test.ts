import { expect, test } from "bun:test";
import { parseFiscalText } from "../src/lib/fiscal-reader-local";
import { calculatedRowTotal } from "../src/lib/fiscal-reader";
import { matchesImportDate } from "../src/lib/import-dates";
import { prepareDocument } from "../src/lib/fiscal-reader-files";

test("local fiscal reading preserves UH and amounts and discards responsible", () => {
  const output = parseFiscalText("UH: 021\nHóspede: Karen Aparecida Vieira\nResponsável: Outra Pessoa\nCPF: 053.103.067-90\nCréditos: 2.000\nVISA: 100,00\nMASTER: 50,00", "local.pdf", "2");
  expect(output.rows).toHaveLength(1);
  expect(output.rows[0].guest).toBe("Karen Aparecida Vieira");
  expect(output.rows[0].uh).toBe("021");
  expect(output.rows[0].credit).toBe("2.000");
  expect(output.rows[0].page).toBe("2");
  expect(calculatedRowTotal(output.rows[0])).toBe(215000);
});
test("date filter includes entire selected day and rejects new files and unknown dates", () => {
  const date = new Date(2026, 9, 21);
  const range = { from: date, to: date };
  expect(matchesImportDate(new Date(2026, 9, 21, 0, 0).toISOString(), range)).toBe(true);
  expect(matchesImportDate(new Date(2026, 9, 21, 23, 59).toISOString(), range)).toBe(true);
  expect(matchesImportDate(new Date(2026, 9, 22, 0, 0).toISOString(), range)).toBe(false);
  expect(matchesImportDate(undefined, range)).toBe(false);
});
test("unmatched spreadsheets read locally without network or AI calls", async () => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["UH: 021"], ["Hóspede: Karen Aparecida Vieira"], ["Créditos: 2.000"]]), "Sheet1");
  const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "local.xlsx");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error("Network forbidden"); }) as typeof fetch;
  try { const output = await prepareDocument(file); expect(output.rows[0].credit).toBe("2.000"); expect(calls).toBe(0); }
  finally { globalThis.fetch = original; }
});