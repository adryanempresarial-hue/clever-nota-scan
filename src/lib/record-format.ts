import type { NotaRecord } from "@/lib/nota.functions";

const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du"]);
export const titleCase = (s: string) =>
  s
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (LOWER_WORDS.has(w) && i > 0 ? w : w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1)))
    .join(" ");

export const digitsOf = (v: string) => v.replace(/\D/g, "");

/** Valores "vazios" que planilhas/OCR trazem: null, undefined, N/A, -, #N/D... */
const EMPTY_TOKENS = new Set([
  "null", "undefined", "nan", "na", "n/a", "n/d", "#n/a", "#n/d", "#valor!", "#value!",
  "-", "--", "---", "?", ".", "nulo", "vazio", "sem informacao", "seminformacao", "none",
]);

export function cleanCell(v: unknown): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const token = s.toLowerCase();
  const bareToken = token.replace(/[^a-zÀ-ÿ0-9/#]+/gi, "").trim();
  if (EMPTY_TOKENS.has(token) || EMPTY_TOKENS.has(bareToken)) return "";
  return s;
}

/** CPF: preserva zeros à esquerda (planilhas cortam) e formata 000.000.000-00 */
export function formatCpf(v: string): string {
  const d = digitsOf(v);
  if (!d) return "";
  if (d.length > 11) return v;
  const p = d.padStart(11, "0");
  return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6, 9)}-${p.slice(9)}`;
}

export function formatCnpj(v: string): string {
  const d = digitsOf(v);
  if (!d || d.length > 14) return v;
  const p = d.padStart(14, "0");
  return `${p.slice(0, 2)}.${p.slice(2, 5)}.${p.slice(5, 8)}/${p.slice(8, 12)}-${p.slice(12)}`;
}

export function formatCep(v: string): string {
  const d = digitsOf(v);
  if (!d || d.length > 8) return v;
  const p = d.padStart(8, "0");
  return `${p.slice(0, 5)}-${p.slice(5)}`;
}

/** Celular/telefone: descarta +55, zeros de operadora e formata (DD) 00000-0000 */
export function formatPhone(v: string): string {
  let d = digitsOf(v);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  while (d.length > 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 12 && d.startsWith("0")) d = d.slice(1);
  if (d.length > 11) d = d.slice(-11);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 9 || d.length === 8) return d.length === 9 ? `${d.slice(0, 5)}-${d.slice(5)}` : `${d.slice(0, 4)}-${d.slice(4)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

/** Máscara progressiva enquanto digita: (DD) 00000-0000 */
export function maskPhoneInput(v: string): string {
  let d = digitsOf(v);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length > 11) d = d.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Válido quando vazio (opcional) ou 10/11 dígitos: DDD + número. */
export function isValidPhone(v: string): boolean {
  const d = digitsOf(v);
  if (!d) return true;
  return d.length === 10 || d.length === 11;
}

/** Normaliza e limpa um registro: sem "null", CPF/CEP com zeros preservados. */
export function sanitizeRecord<T extends NotaRecord>(rec: T): T {
  const out = { ...rec } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (k.startsWith("_")) continue;
    const cleaned = cleanCell(out[k]);
    out[k] = cleaned || null;
  }
  if (out.cpf) out.cpf = formatCpf(String(out.cpf));
  if (out.cnpj) out.cnpj = formatCnpj(String(out.cnpj));
  if (out.cep) out.cep = formatCep(String(out.cep));
  if (out.telefone) out.telefone = formatPhone(String(out.telefone));
  if (out.nome) out.nome = titleCase(String(out.nome));
  if (out.email) out.email = String(out.email).toLowerCase();
  return out as T;
}
