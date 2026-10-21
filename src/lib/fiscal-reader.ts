export type PaymentRow = {
  uh: string; guest: string; cpf: string; credit: string; brand: string; amount: string;
  page?: string; comp?: string; payments?: { brand: string; amount: string }[];
  source: string; doubts: string[]; reviewed: boolean; excluded?: boolean;
};
export type FiscalTotal = { uh: string; guest: string; paymentsCents: number; creditsCents: number };
export const paymentFields = ["page", "uh", "comp", "guest", "cpf", "credit", "brand", "amount"] as const;
export const paymentLabels = ["Página de origem", "UH / apartamento", "Código/comp.", "Hóspede", "CPF", "Créditos", "Bandeira", "Pagamento"];
export const resultHeaders = ["Página de origem", "UH", "Código/comp.", "Hóspede", "Créditos", "Meios de pagamento identificados", "Total calculado", "Situação"];
export const rowPayments = (row: PaymentRow) => row.payments ?? (row.amount || row.brand ? [{ brand: row.brand, amount: row.amount }] : []);
export function calculatedRowTotal(row: PaymentRow): number | null {
  const values = [row.credit, ...rowPayments(row).map(p => p.amount)].filter(v => v !== "");
  if (!values.length || rowPayments(row).some(p => !p.amount)) return null;
  const cents = values.map(moneyCents);
  return cents.some(v => v === null) ? null : cents.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}
export function readingStatus(row: PaymentRow): string {
  if (calculatedRowTotal(row) === null) return "Conferir valor";
  if (!row.guest || (!row.reviewed && row.doubts.some(d => /nome|h[oó]spede|respons[aá]vel/i.test(d)))) return "Revisar nome";
  return row.reviewed ? "Conferido" : "Conferir leitura";
}
export function cleanCell(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^(?:\*\*\s*)?null(?:\s*\*\*)?$/i.test(text) ? "" : text;
}
// Never convert an unreadable value to zero. An ambiguous 2.000 means 2000 in Brazilian reports.
export function moneyCents(raw: string): number | null {
  let text = cleanCell(raw).replace(/R\$\s*/g, "").replace(/\s/g, "");
  if (!text) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) text = text.replace(/\./g, "");
  if (!/^-?\d+(?:[,.]\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const negative = whole.startsWith("-");
  const n = Number(whole.replace("-", "")) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(n) ? (negative ? -n : n) : null;
}
export const displayCents = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function rowDoubts(row: PaymentRow): string[] {
  const doubts = [...row.doubts];
  if (!row.uh) doubts.push("UH ausente");
  if (!row.guest) doubts.push("Hóspede ausente");
  if (!rowPayments(row).length && !row.credit) doubts.push("Valor ausente");
  if (rowPayments(row).some(p => !p.amount || moneyCents(p.amount) === null)) doubts.push("Pagamento ilegível ou ambíguo");
  if (row.credit && moneyCents(row.credit) === null) doubts.push("Crédito ilegível ou ambíguo");
  return [...new Set(doubts)];
}
export function possibleDuplicates(rows: PaymentRow[]): number[] {
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.excluded) return;
    const key = JSON.stringify([paymentFields.map(f => f === "amount" || f === "credit" ? moneyCents(r[f] ?? "") ?? cleanCell(r[f]) : f === "cpf" ? r[f].replace(/\D/g, "") : cleanCell(r[f]).toLocaleLowerCase("pt-BR")), rowPayments(r).map(p => [cleanCell(p.brand).toLowerCase(), moneyCents(p.amount) ?? p.amount])]);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  return [...groups.values()].filter(v => v.length > 1).flat();
}
export function calculateTotals(rows: PaymentRow[]): FiscalTotal[] {
  const groups = new Map<string, FiscalTotal>();
  for (const r of rows) {
    if (r.excluded) continue;
    const key = JSON.stringify([r.uh.trim(), r.guest.trim().toLocaleLowerCase("pt-BR"), r.cpf.replace(/\D/g, "")]);
    const group = groups.get(key) ?? { uh: r.uh, guest: r.guest, paymentsCents: 0, creditsCents: 0 };
    group.paymentsCents += rowPayments(r).reduce((sum, p) => sum + (moneyCents(p.amount) ?? 0), 0);
    group.creditsCents += moneyCents(r.credit) ?? 0;
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function canConfirm(all: PaymentRow[], duplicatesReviewed: boolean): boolean {
  const rows = all.filter(r => !r.excluded);
  return rows.length > 0 && rows.every(r => r.reviewed && r.uh.trim() && r.guest.trim() &&
    calculatedRowTotal(r) !== null) &&
    (possibleDuplicates(rows).length === 0 || duplicatesReviewed);
}
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Record<typeof paymentFields[number], string[]> = {
  page: ["pagina", "pag", "pagina de origem"],
  comp: ["comp", "codigo", "codigo/comp", "comprovante"],
  uh: ["uh", "apartamento", "apart", "apto", "numero da uh", "unidade habitacional", "hub"],
  guest: ["nome", "hospede", "nome do hospede", "cliente", "titular"],
  cpf: ["cpf", "cpf/cnpj", "documento"],
  credit: ["creditos", "credito", "valor credito"],
  brand: ["bandeira", "bandeira do cartao", "cartao"],
  amount: ["pagamento", "valor", "valor pagamento", "valor do pagamento", "valor pago", "valor de cada pagamento"],
};
export function parsePaymentSheet(matrix: unknown[][], source: string): PaymentRow[] | null {
  let columns: Partial<Record<typeof paymentFields[number], number>> = {};
  let header = -1;
  for (let i = 0; i < matrix.length; i++) {
    const found: typeof columns = {};
    let guestPriority = -1;
    matrix[i].forEach((v, c) => {
      const key = normalize(cleanCell(v));
      for (const f of paymentFields) if (aliases[f].some(a => normalize(a) === key)) {
        if (f === "guest") {
          const priority = key === "hospede" || key === "nomedohospede" ? 2 : 1;
          if (priority > guestPriority) { found[f] = c; guestPriority = priority; }
        } else found[f] = c;
      }
    });
    if ((found.uh !== undefined || found.guest !== undefined) && (found.amount !== undefined || found.credit !== undefined)) {
      header = i; columns = found; break;
    }
  }
  if (header < 0) return null;
  const rows: PaymentRow[] = [];
  for (const cells of matrix.slice(header + 1)) {
    const get = (f: typeof paymentFields[number]) => columns[f] === undefined ? "" : cleanCell(cells[columns[f] as number]);
    const row: PaymentRow = { page: get("page"), comp: get("comp"), uh: get("uh"), guest: get("guest"), cpf: get("cpf"), credit: get("credit"), brand: get("brand"), amount: get("amount"), source, doubts: [], reviewed: false };
    if (!paymentFields.some(f => row[f])) continue;
    if (normalize(row.uh) === "uh" || normalize(row.guest) === "hospede" || /^(total|subtotal|saldo)\b/i.test(row.uh || row.guest)) continue;
    row.doubts = rowDoubts(row);
    rows.push(row);
  }
  return rows;
}// Same split as the Cálculo Fiscal: service %, food % of the remainder, cold drinks the rest. Integer cents.
export function fiscalSplit(totalCents: number, servicePct = 30, foodPct = 30) {
  const servico = Math.round(totalCents * servicePct / 100);
  const alimentacao = Math.round((totalCents - servico) * foodPct / 100);
  return { total: totalCents, servico, alimentacao, bebidas: totalCents - servico - alimentacao };
}
export const documentTotalCents = (rows: PaymentRow[]) => rows.reduce((sum, r) => sum + (r.excluded ? 0 : calculatedRowTotal(r) ?? 0), 0);
