import { parsePaymentSheet, rowDoubts, type PaymentRow } from "./fiscal-reader";

const label = /\b(UH|HUB|Apartamento|Apto|Comp\.?|Comprovante|C[oó]digo|H[oó]spede|Nome do h[oó]spede|Respons[aá]vel|CPF(?:\/CNPJ)?|Cr[eé]ditos?|Pagamentos?|Bandeira|VISA|MASTER(?:CARD)?|ELO|PIX|DINHEIRO|AMEX)\b\s*[:=]?\s*/gi;
const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function parseFiscalText(text: string, source: string, page = ""): { rows: PaymentRow[]; warnings: string[] } {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const matrix = lines.map(line => line.split(/\t|\s{2,}|\s*\|\s*/));
  const table = parsePaymentSheet(matrix, source);
  if (table?.length) return { rows: table.map(row => ({ ...row, page: row.page || page })), warnings: [] };
  const rows: PaymentRow[] = [];
  let current: PaymentRow | undefined;
  let pendingBrand = "";
  const make = (): PaymentRow => ({ uh: "", guest: "", cpf: "", credit: "", brand: "", amount: "", payments: [], source, page, comp: "", reviewed: false, doubts: [] });
  const finish = () => {
    if (!current || ![current.uh, current.guest, current.cpf, current.credit, ...(current.payments ?? []).map(p => p.amount)].some(Boolean)) return;
    current.doubts = rowDoubts(current);
    rows.push(current);
  };
  for (const line of lines) {
    const labels = [...line.matchAll(label)];
    for (let i = 0; i < labels.length; i++) {
      const match = labels[i];
      const key = norm(match[1]);
      const value = line.slice((match.index ?? 0) + match[0].length, labels[i + 1]?.index ?? line.length).trim().replace(/[;|]+$/, "").trim();
      if (key === "responsavel") continue;
      if (["uh", "hub", "apartamento", "apto"].includes(key) && current?.uh) { finish(); current = undefined; pendingBrand = ""; }
      current ??= make();
      if (["uh", "hub", "apartamento", "apto"].includes(key)) current.uh = value;
      else if (["comp", "comprovante", "codigo"].includes(key)) current.comp = value;
      else if (["hospede", "nomedohospede"].includes(key)) current.guest = value;
      else if (key.startsWith("cpf")) current.cpf = value;
      else if (key.startsWith("credito")) current.credit = value;
      else if (key === "bandeira") pendingBrand = value;
      else if (key.startsWith("pagamento")) { current.payments?.push({ brand: pendingBrand, amount: value }); pendingBrand = ""; }
      else { current.payments?.push({ brand: match[1], amount: value }); }
    }
  }
  finish();
  return { rows, warnings: rows.length ? ["Leitura local por campos identificados. Confira todas as linhas e valores no original; outros formatos podem não ter sido reconhecidos."] : ["Não foi possível reconhecer os campos deste formato na leitura local. O original foi preservado; nenhum valor foi inventado."] };
}