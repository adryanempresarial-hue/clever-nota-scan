import type { PaymentRow } from "./fiscal-reader";
import { matchesImportDate, type ImportDates } from "./import-dates";

type Contact = { nome?: string | null; cpf?: string | null; telefone?: string | null; email?: string | null; cep?: string | null; numero?: string | null; uh?: string | null; _id?: string; _arquivo?: string; _createdAt?: string };
type CrmContact = { id: string; arquivo?: string; created_at?: string; campos: { rotulo: string; valor: string }[] };
export type ScannedHit = { key: string; source: "Nota" | "CRM" | "Fiscal"; title: string; subtitle: string; importedAt?: string; lines: { label: string; value: string }[]; apartments: string[] };
const normalized = (s: string) => s.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
const digits = (s: string) => s.replace(/\D/g, "");
export function matchingApartments(name: string, cpf: string, rows: PaymentRow[]) {
  const document = digits(cpf);
  return [...new Set(rows.filter(r => !r.excluded && r.uh && (document && digits(r.cpf) ? document === digits(r.cpf) : Boolean(normalized(name)) && normalized(name) === normalized(r.guest))).map(r => r.uh))];
}
// Apartment metadata is separate from the standard fields used by Copy all.
export const scannedCopyText = (hit: Pick<ScannedHit, "lines">) => hit.lines.map(l => `${l.label}: ${l.value}`).join("\n");
export function scannedSearch(query: string, contacts: Contact[], crm: CrmContact[], allRows: (PaymentRow & { importedAt?: string })[], dates: ImportDates = {}): ScannedHit[] {
  const rows = allRows.filter(row => matchesImportDate(row.importedAt, dates));
  if (query.trim().length < 2) return [];
  const q = normalized(query), qd = digits(query);
  const matches = (name: string, cpf: string) => normalized(name).includes(q) || (qd.length >= 3 && digits(cpf).includes(qd));
  const hits: ScannedHit[] = [];
  for (const r of contacts) {
    if (!matchesImportDate(r._createdAt, dates)) continue;
    const name = r.nome || "", cpf = r.cpf || "";
    if (!matches(name, cpf)) continue;
    hits.push({ key: `nota-${r._id ?? name + cpf}`, source: "Nota", title: name || "(sem nome)", subtitle: r._arquivo || "", importedAt: r._createdAt, apartments: [...new Set([...(r.uh ? [r.uh] : []), ...matchingApartments(name, cpf, rows)])], lines: [
      { label: "Nome", value: name }, { label: "CPF", value: cpf }, { label: "Telefone", value: r.telefone || "" }, { label: "E-mail", value: r.email || "" }, { label: "CEP", value: r.cep || "" }, { label: "Número", value: r.numero || "" },
    ].filter(l => l.value) });
  }
  for (const r of crm) {
    if (!matchesImportDate(r.created_at, dates)) continue;
    const name = r.campos.find(c => /nome|raz[aã]o/i.test(c.rotulo))?.valor || "";
    const cpf = r.campos.find(c => /cpf|cnpj/i.test(c.rotulo))?.valor || "";
    if (!matches(name, cpf)) continue;
    hits.push({ key: `crm-${r.id}`, source: "CRM", title: name || "(sem nome)", subtitle: r.arquivo || "", importedAt: r.created_at, apartments: matchingApartments(name, cpf, rows), lines: r.campos.filter(c => c.valor).slice(0, 8).map(c => ({ label: c.rotulo, value: c.valor })) });
  }
  for (const r of rows) {
    if (r.excluded || !matches(r.guest, r.cpf)) continue;
    if (hits.some(h => h.lines.some(l => /cpf|cnpj/i.test(l.label) && digits(l.value) && digits(l.value) === digits(r.cpf)) || normalized(h.title) === normalized(r.guest))) continue;
    hits.push({ key: `fiscal-${r.guest}-${r.cpf}`, source: "Fiscal", title: r.guest || "(sem nome)", subtitle: r.source, importedAt: r.importedAt, apartments: matchingApartments(r.guest, r.cpf, rows), lines: [{ label: "Nome", value: r.guest }, { label: "CPF", value: r.cpf }].filter(l => l.value) });
  }
  return hits.slice(0, 20);
}