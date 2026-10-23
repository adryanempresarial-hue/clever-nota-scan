import { expect, test } from "bun:test";
import { parseContactMatrix, parseSheetRecords } from "../src/lib/contact-import";
import { formatPhone, isValidPhone } from "../src/lib/record-format";

test("retains all 107 contacts with complete source fields and UH independent of address number", () => {
  const matrix = [["Nome", "CPF/CNPJ", "E-mail", "Fone Res", "Fone Com", "CEP", "Nr.", "Unidade"],
    ...Array.from({ length: 107 }, (_, i) => [`Karen Aparecida Vieira ${i}`, "05310306790", `karen${i}@example.com`, "(21) 2345-6789", "+55 21 98702-2161", "01234567", "2.000", "021"])];
  const records = parseContactMatrix(matrix, "clientes.xls — Sheet1");
  expect(records).toHaveLength(107);
  for (let i = 0; i < 107; i++) {
    expect(records[i].nome).toBe(`Karen Aparecida Vieira ${i}`);
    expect(records[i].cpf).toBe("053.103.067-90");
    expect(records[i].email).toBe(`karen${i}@example.com`);
    expect(records[i].telefone).toBe("(21) 2345-6789; (21) 98702-2161");
    expect(records[i].cep).toBe("01234-567");
    expect(records[i].numero).toBe("2.000");
    expect(records[i].uh).toBe("021");
  }
});

test("all apartment aliases go to UH and never become street number", () => {
  for (const header of ["UH", "Hub", "Unidade", "Unidade Habitacional", "Apartamento", "Apto", "Nº UH"]) {
    const rows = parseContactMatrix([["Nome", header], ["Karen Vieira", "021"]], "alias.xls");
    expect(rows[0].uh).toBe("021");
    expect(rows[0].numero).toBeUndefined();
  }
});

test("repeated and multi-row headers are skipped without losing source line reference", () => {
  const rows = parseContactMatrix([["Nome", "", "UH"], ["", "E-mail", ""], ["Karen Vieira", "karen@example.com", "021"], ["Nome", "E-mail", "UH"], ["Ana Ramos", "ana@example.com", "612"]], "clientes.xls");
  expect(rows).toHaveLength(2);
  expect(rows[0]._arquivo).toBe("clientes.xls · linha 3");
  expect(rows[1].uh).toBe("612");
});

test("keeps multiple emails and partial phones without interpreting them as CPF", () => {
  const rows = parseContactMatrix([["Nome", "E-mail", "Celular"], ["Ana", "ANA@example.com; outro@example.com", "98702-2161"]], "parcial.xls");
  expect(rows[0].email).toBe("ana@example.com; outro@example.com");
  expect(rows[0].telefone).toBe("98702-2161");
  expect(rows[0].cpf).toBeUndefined();
  expect(formatPhone("1234567890123456")).toBe("1234567890123456");
  expect(isValidPhone("(21) 2345-6789; (21) 98702-2161")).toBe(true);
});

test("reads XLS locally and preserves leading-zero UH and blank rows in line numbers", async () => {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Nome", "UH", "Nr"], [], ["Karen Vieira", "021", "0"]]), "Sheet1");
  const file = new File([XLSX.write(wb, { type: "array", bookType: "biff8" })], "clientes.xls");
  const rows = await parseSheetRecords(file);
  expect(rows[0].uh).toBe("021");
  expect(rows[0].numero).toBe("0");
  expect(rows[0]._arquivo).toBe("clientes.xls — Sheet1 · linha 3");
});