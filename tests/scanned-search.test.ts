import { expect, test } from "bun:test";
import { scannedSearch, scannedCopyText, matchingApartments } from "../src/lib/scanned-search";

const fiscal = { uh: "023", guest: "Fabiana Ramos Alves", cpf: "05310306790", credit: "100,00", brand: "Visa", amount: "200,00", source: "original.xlsx", doubts: [], reviewed: true };
test("name search joins the matching apartment without adding it to standard copy", () => {
  const contact = { nome: "Fabiana Ramos Alves", cpf: "053.103.067-90", telefone: "(21) 98702-2161", email: "fabivanzin@ig.com.br", numero: "0" };
  const hit = scannedSearch("Fabiana", [contact], [], [fiscal])[0];
  expect(hit.apartments).toEqual(["023"]);
  expect(scannedCopyText(hit)).toBe("Nome: Fabiana Ramos Alves\nCPF: 053.103.067-90\nTelefone: (21) 98702-2161\nE-mail: fabivanzin@ig.com.br\nNúmero: 0");
  expect(fiscal.amount).toBe("200,00");
});
test("different CPFs must not join apartments even when names match", () => {
  expect(matchingApartments("Fabiana Ramos Alves", "99999999999", [fiscal])).toEqual([]);
});
test("quick search dates scope contacts and apartments without modifying standard copy", () => {
  const old = new Date(2026, 9, 20, 12).toISOString(), current = new Date(2026, 9, 21, 12).toISOString();
  const contacts = [{ nome: fiscal.guest, cpf: fiscal.cpf, _createdAt: old }, { nome: fiscal.guest, cpf: fiscal.cpf, _createdAt: current, _id: "new" }];
  const hits = scannedSearch("Fabiana", contacts, [], [{ ...fiscal, importedAt: old }, { ...fiscal, uh: "022", importedAt: current }], { from: new Date(2026, 9, 21), to: new Date(2026, 9, 21) });
  expect(hits).toHaveLength(1); expect(hits[0].key).toBe("nota-new"); expect(hits[0].apartments).toEqual(["022"]);
  expect(scannedCopyText(hits[0])).toBe("Nome: Fabiana Ramos Alves\nCPF: 05310306790");
});