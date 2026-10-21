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