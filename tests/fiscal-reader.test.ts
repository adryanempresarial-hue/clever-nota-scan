import { describe, test, expect } from "bun:test";
import { moneyCents, calculateTotals, possibleDuplicates, canConfirm, parsePaymentSheet } from "../src/lib/fiscal-reader";
const row = { uh: "21", guest: "Ana", cpf: "05310306790", credit: "", brand: "Visa", amount: "2.000", source: "arquivo.xls", doubts: [], reviewed: false };
describe("Fiscal reader rules", () => {
  test("preserves 2.000 as two thousand, not 2.0", () => expect(moneyCents("2.000")).toBe(200000));
  test("sums payments in cents by UH and guest", () => expect(calculateTotals([row, { ...row, amount: "1.500,25" }, { ...row, uh: "22", amount: "0,10" }])).toEqual([{ uh: "21", guest: "Ana", paymentsCents: 350025, creditsCents: 0 }, { uh: "22", guest: "Ana", paymentsCents: 10, creditsCents: 0 }]));
  test("duplicates remain and require review", () => { expect(possibleDuplicates([row, row])).toEqual([0, 1]); expect(canConfirm([{ ...row, reviewed: true }, { ...row, reviewed: true }], false)).toBe(false); });
  test("unreadable amounts are not confirmed", () => expect(canConfirm([{ ...row, amount: "ilegível", reviewed: true }], true)).toBe(false));
  test("unreviewed rows are not confirmed", () => expect(canConfirm([row], true)).toBe(false));
  test("spreadsheet extraction preserves CPF zeros and original values", () => { const rows = parsePaymentSheet([["UH", "Hóspede", "CPF", "Créditos", "Bandeira", "Pagamento"], ["21", "Ana", "05310306790", "NULL", "Visa", "2.000"]], "arquivo.xls"); expect(rows?.[0].cpf).toBe("05310306790"); expect(rows?.[0].amount).toBe("2.000"); expect(rows?.[0].credit).toBe(""); });
});