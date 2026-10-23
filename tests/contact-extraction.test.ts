import { expect, test } from "bun:test";
import { ContactExtractionSchema, assembleExtractedContacts } from "../src/lib/contact-extraction";

test("one document supports multiple people, UH and partial contacts without mixing fields", () => {
  const result = ContactExtractionSchema.parse({ records: [
    { nome: "Karen Vieira", uh: "021", cpf: "05310306790", email: "KAREN@example.com; outro@example.com", telefone: "(21) 2345-6789; (21) 98702-2161", cep: "01234567", numero: "2.000" },
    { nome: "Ana Ramos", uh: "612", email: "ana@example.com" },
    { telefone: "98702-2161" }, {},
  ] });
  const rows = assembleExtractedContacts(result.records, "lista.pdf");
  expect(rows).toHaveLength(3);
  expect(rows[0].uh).toBe("021");
  expect(rows[0].numero).toBe("2.000");
  expect(rows[0].email).toBe("karen@example.com; outro@example.com");
  expect(rows[0].telefone).toBe("(21) 2345-6789; (21) 98702-2161");
  expect(rows[1].cpf).toBeUndefined();
  expect(rows[2].telefone).toBe("98702-2161");
  expect(rows[2]._arquivo).toBe("lista.pdf · registro 3");
});