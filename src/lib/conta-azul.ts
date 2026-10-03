import * as XLSX from "xlsx";

export type ContaAzulClient = {
  nome: string;
  cpfCnpj: string;
  email: string;
  telefone: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
};

export const CSV_HEADERS = [
  "Nome do cliente", "CPF/CNPJ", "E-mail", "Telefone", "CEP", "Endereço",
  "Número", "Complemento", "Bairro", "Cidade", "Estado",
] as const;

const CSV_KEYS: (keyof ContaAzulClient)[] = [
  "nome", "cpfCnpj", "email", "telefone", "cep", "endereco",
  "numero", "complemento", "bairro", "cidade", "estado",
];

const NULL_TOKENS = new Set(["null", "none", "nan", "undefined", "n/a", "-"]);

export function normalizeValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && !Number.isFinite(v)) return "";
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return "";
  const core = s.replace(/\*/g, "").trim().toLowerCase();
  if (!core || NULL_TOKENS.has(core)) return "";
  return s;
}

export function isNullPhone(v: unknown): boolean {
  const s = normalizeValue(v);
  return !s || s.replace(/\D/g, "").length === 0 || /^0+$/.test(s.replace(/\D/g, ""));
}

export function formatPhone(v: unknown): string {
  const s = normalizeValue(v);
  let d = s.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** Fone Res -> Fone Com -> FoneCel; returns only the first real phone. */
export function extractFirstPhone(candidates: unknown[]): string {
  for (const c of candidates) if (!isNullPhone(c)) return formatPhone(c);
  return "";
}

export function normalizeCpfCnpj(v: unknown): string {
  return normalizeValue(v).replace(/\D/g, "");
}

export function normalizeCep(v: unknown): string {
  return normalizeValue(v).replace(/\D/g, "");
}

const strip = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string[]> = {
  nome: ["nome", "nomecliente", "razaosocial", "nomedocliente"],
  cpfCnpj: ["cpfcnpj", "cpf", "cnpj", "documento"],
  email: ["email", "correioeletronico"],
  foneRes: ["foneres", "foneresidencial", "telefoneresidencial", "telres", "telefone", "fone"],
  foneCom: ["fonecom", "fonecomercial", "telefonecomercial", "telcom"],
  foneCel: ["fonecel", "telefonecelular", "celular", "cel", "fonecelular"],
  cep: ["cep", "codigopostal"],
  endereco: ["endereco", "logradouro", "rua"],
  numero: ["nr", "numero", "n", "no", "num"],
  complemento: ["compl", "complemento"],
  bairro: ["bairro"],
  cidade: ["cidade", "municipio"],
  estado: ["uf", "estado"],
};

function mapHeaders(row: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  const keys = row.map((h) => strip(String(h ?? "").replace(/º/g, "o")));
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const idx = keys.findIndex((k) => k && aliases.includes(k));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export class ContaAzulError extends Error {}

export async function parseLegacyXls(file: File): Promise<ContaAzulClient[]> {
  let wb: XLSX.WorkBook;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: "array", raw: true, cellText: true, cellDates: false });
  } catch {
    throw new ContaAzulError("Não foi possível ler este arquivo. Verifique se ele é um XLS/XLSX válido.");
  }
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1, raw: false, defval: "", blankrows: false,
    });
    for (let h = 0; h < Math.min(rows.length, 30); h++) {
      const map = mapHeaders(rows[h] ?? []);
      if (map.nome === undefined) continue;
      const get = (r: unknown[], f: string) => (map[f] === undefined ? "" : normalizeValue(r[map[f]]));
      const out: ContaAzulClient[] = [];
      for (const r of rows.slice(h + 1)) {
        const nome = get(r, "nome");
        const anyData = Object.keys(map).some((f) => get(r, f));
        if (!nome && !anyData) continue;
        if (strip(nome) === "nome") continue; // repeated header
        out.push({
          nome,
          cpfCnpj: normalizeCpfCnpj(get(r, "cpfCnpj")),
          email: get(r, "email"),
          telefone: extractFirstPhone([get(r, "foneRes"), get(r, "foneCom"), get(r, "foneCel")]),
          cep: normalizeCep(get(r, "cep")),
          endereco: get(r, "endereco"),
          numero: get(r, "numero"),
          complemento: get(r, "complemento"),
          bairro: get(r, "bairro"),
          cidade: get(r, "cidade"),
          estado: get(r, "estado"),
        });
      }
      return out;
    }
  }
  throw new ContaAzulError("Não foi possível identificar a coluna Nome neste arquivo.");
}

export type ValidationSummary = {
  total: number;
  comTelefone: number;
  semTelefone: number;
  comDoc: number;
  semDoc: number;
  issues: { campo: string; quantidade: number }[];
};

export function validateImportedClients(list: ContaAzulClient[]): ValidationSummary {
  const comTelefone = list.filter((c) => c.telefone).length;
  const comDoc = list.filter((c) => c.cpfCnpj).length;
  const count = (fn: (c: ContaAzulClient) => boolean) => list.filter(fn).length;
  const issues = [
    { campo: "Nome vazio", quantidade: count((c) => !c.nome) },
    { campo: "CPF/CNPJ com tamanho inválido", quantidade: count((c) => !!c.cpfCnpj && c.cpfCnpj.length !== 11 && c.cpfCnpj.length !== 14) },
    { campo: "E-mail inválido", quantidade: count((c) => !!c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) },
    { campo: "Telefone sem 10/11 dígitos", quantidade: count((c) => !!c.telefone && !c.telefone.startsWith("(")) },
    { campo: "CEP sem 8 dígitos", quantidade: count((c) => !!c.cep && c.cep.length !== 8) },
  ].filter((i) => i.quantidade > 0);
  return {
    total: list.length, comTelefone, semTelefone: list.length - comTelefone,
    comDoc, semDoc: list.length - comDoc, issues,
  };
}

const esc = (v: string) => {
  const s = normalizeValue(v);
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildContaAzulCsv(list: ContaAzulClient[]): Blob {
  const lines = [CSV_HEADERS.map(esc).join(";"), ...list.map((c) => CSV_KEYS.map((k) => esc(c[k])).join(";"))];
  return new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
}

export const CONTA_AZUL_LIMIT = 500;

export function splitInParts<T>(list: T[], size = CONTA_AZUL_LIMIT): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
}
