import { describe, test, expect } from "bun:test";
import { moneyCents, calculateTotals, possibleDuplicates, canConfirm, parsePaymentSheet, calculatedRowTotal, readingStatus } from "../src/lib/fiscal-reader";
const row = { uh: "21", guest: "Ana", cpf: "05310306790", credit: "", brand: "Visa", amount: "2.000", source: "arquivo.xls", doubts: [], reviewed: false };
describe("Fiscal reader rules", () => {
  test("uses Hóspede regardless of column order and discards Responsável", () => {
    for (const [headers, cells] of [
      [["UH", "Hóspede", "Responsável", "Nome", "Pagamento"], ["021", "Ana hóspede", "Responsável diferente", "Outro nome", "100,00"]],
      [["UH", "Nome", "Responsável", "Hóspede", "Pagamento"], ["021", "Outro nome", "Responsável diferente", "Ana hóspede", "100,00"]],
    ]) expect(parsePaymentSheet([headers, cells], "teste.xlsx")?.[0].guest).toBe("Ana hóspede");
    expect(parsePaymentSheet([["UH", "Responsável", "Pagamento"], ["21", "Não é hóspede", "100,00"]], "teste.xlsx")?.[0].guest).toBe("");
  });
  test("corrected credits and payments recalculate totals and split without changing originals", () => {
    const original = { ...row, credit: "100,00", payments: [{ brand: "Visa", amount: "200,00" }] };
    const corrected = { ...original, credit: "150,00", payments: [{ brand: "Visa", amount: "250,00" }] };
    expect(calculatedRowTotal(corrected)).toBe(40000);
    expect(fiscalSplit(calculatedRowTotal(corrected) ?? 0)).toEqual({ total: 40000, servico: 12000, alimentacao: 8400, bebidas: 19600 });
    expect(calculatedRowTotal(original)).toBe(30000);
  });
  test("credits plus every payment form separate total without changing originals", () => {
    const record = { ...row, credit: "4.837,00", amount: "", payments: [{ brand: "MASTER", amount: "1.372,00" }, { brand: "MASTER", amount: "2.387,00" }] };
    expect(calculatedRowTotal(record)).toBe(859600);
    expect(record.credit).toBe("4.837,00"); expect(record.payments[1].amount).toBe("2.387,00");
    expect(calculateTotals([record])[0].paymentsCents).toBe(375900);
  });
  test("ambiguous payment is not turned into a computed zero", () => {
    const record = { ...row, credit: "2.000,00", payments: [{ brand: "VISA", amount: "ilegível" }], reviewed: true };
    expect(calculatedRowTotal(record)).toBeNull(); expect(canConfirm([record], true)).toBe(false); expect(readingStatus(record)).toBe("Conferir valor");
  });
  test("page and comp preserve document reference and leading zeros", () => {
    const records = parsePaymentSheet([["Pág.", "UH", "Comp.", "Responsável", "Créditos", "Pagamento"], ["2", "023", "042280", "Ana", "4.090,00", "849,60"]], "original.xls");
    expect(records?.[0].page).toBe("2"); expect(records?.[0].comp).toBe("042280"); expect(records?.[0].uh).toBe("023"); expect(calculatedRowTotal(records?.[0] ?? row)).toBe(493960);
  });
  test("preserves 2.000 as two thousand, not 2.0", () => expect(moneyCents("2.000")).toBe(200000));
  test("sums payments in cents by UH and guest", () => expect(calculateTotals([row, { ...row, amount: "1.500,25" }, { ...row, uh: "22", amount: "0,10" }])).toEqual([{ uh: "21", guest: "Ana", paymentsCents: 350025, creditsCents: 0 }, { uh: "22", guest: "Ana", paymentsCents: 10, creditsCents: 0 }]));
  test("duplicates remain and require review", () => { expect(possibleDuplicates([row, row])).toEqual([0, 1]); expect(canConfirm([{ ...row, reviewed: true }, { ...row, reviewed: true }], false)).toBe(false); });
  test("equivalent numeric formatting still flags duplicate payments", () => expect(possibleDuplicates([row, { ...row, amount: "R$ 2.000,00", cpf: "053.103.067-90" }])).toEqual([0, 1]));
  test("unreadable amounts are not confirmed", () => expect(canConfirm([{ ...row, amount: "ilegível", reviewed: true }], true)).toBe(false));
  test("unreviewed rows are not confirmed", () => expect(canConfirm([row], true)).toBe(false));
  test("spreadsheet extraction preserves CPF zeros and original values", () => { const rows = parsePaymentSheet([["UH", "Hóspede", "CPF", "Créditos", "Bandeira", "Pagamento"], ["21", "Ana", "05310306790", "NULL", "Visa", "2.000"]], "arquivo.xls"); expect(rows?.[0].cpf).toBe("05310306790"); expect(rows?.[0].amount).toBe("2.000"); expect(rows?.[0].credit).toBe(""); });
});import { fiscalSplit, documentTotalCents } from "../src/lib/fiscal-reader";
describe("Document fiscal split", () => {
  test("splits like Cálculo Fiscal and closes to the total", () => { const s = fiscalSplit(13037289); expect(s.servico).toBe(3911187); expect(s.alimentacao).toBe(2737831); expect(s.bebidas).toBe(6388271); expect(s.servico + s.alimentacao + s.bebidas).toBe(13037289); });
  test("excluded rows leave totals", () => { const r = { uh: "21", guest: "Ana", cpf: "", credit: "", brand: "", amount: "100,00", source: "x", doubts: [], reviewed: true }; expect(documentTotalCents([r, { ...r, excluded: true }])).toBe(10000); });
});
import { fillClosingSheets, closingEntries, selectedClosingRows } from "../src/lib/fiscal-closing-export";
describe("Fechamento Verdes Vales export", () => {
  test("all saved documents combine when marked; unmarked files are omitted", () => {
    const runs = [{ id: "first", corrected_rows: [row] }, { id: "second", corrected_rows: [{ ...row, uh: "22", amount: "100,00" }] }];
    expect(closingEntries(selectedClosingRows(runs, new Set(["first", "second"])))).toEqual([{ uh: "21", cents: 200000 }, { uh: "22", cents: 10000 }]);
    expect(closingEntries(selectedClosingRows(runs, new Set(["second"])))).toEqual([{ uh: "22", cents: 10000 }]);
    expect(selectedClosingRows(runs, new Set())).toEqual([]);
  });
  test("current corrections apply only to the selected current document", () => {
    const runs = [{ id: "first", corrected_rows: [row] }, { id: "second", corrected_rows: [{ ...row, amount: "100,00" }] }];
    const current = { id: "first", rows: [{ ...row, amount: "50,00" }, { ...row, excluded: true }] };
    expect(closingEntries(selectedClosingRows(runs, new Set(["first", "second"]), current))).toEqual([{ uh: "21", cents: 5000 }, { uh: "21", cents: 10000 }]);
    expect(closingEntries(selectedClosingRows(runs, new Set(["second"]), current))).toEqual([{ uh: "21", cents: 10000 }]);
  });
  test("fills every column with computed values and edited date", () => {
    const { launch, closing } = fillClosingSheets('<c r="C4" s="2"><v>46310</v></c><c r="B9" s="8" t="s"><v>22</v></c><c r="C9" s="9"><v>1</v></c><c r="D9" s="10"><f>X</f><v>1</v></c><c r="G9" s="11"><f t="shared" si="2"/></c><c r="J9" s="13" t="str"><f>Y</f><v>Completo</v></c>', '<c r="C5" s="16"><f>S</f><v>1</v></c><c r="I9" s="12"><f>Z</f><v>1</v></c>', [{ uh: "023", cents: 493960 }], "2026-10-20");
    expect(launch).toContain('<c r="C4" s="2"><v>46315</v></c>'); expect(launch).toContain("<t>023</t>"); expect(launch).toContain('<c r="D9" s="10"><f>X</f><v>1481.88</v></c>'); expect(launch).toContain('<c r="G9" s="11"><f t="shared" si="2"/><v>2420.4</v></c>');
    expect(closing).toContain('<c r="C5" s="16"><f>S</f><v>4939.6</v></c>'); expect(closing).toContain('<v>4939.6</v></c>');
  });
  test("excluded and unreadable rows are left out", () => { const r = { uh: "21", guest: "A", cpf: "", credit: "", brand: "", amount: "10,00", source: "", doubts: [], reviewed: true }; expect(closingEntries([r, { ...r, excluded: true }, { ...r, amount: "x" }])).toEqual([{ uh: "21", cents: 1000 }]); });
});
