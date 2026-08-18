import type { NotaRecord } from "@/lib/nota.functions";

type ViaCepItem = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

const cache = new Map<string, string | null>();

const strip = (v?: string | null) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Remove número/complemento do logradouro: "Rua X, 123 - apto 2" -> "Rua X" */
function streetOnly(endereco?: string | null) {
  let s = (endereco ?? "").split(/[,;]/)[0] ?? "";
  s = s.replace(/\b(n[º°.]?\s*)?\d+.*$/i, "").trim();
  return s.replace(/\s+/g, " ").trim();
}

const UFS = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR",
  "PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

/** Consulta o ViaCEP por endereço + cidade + UF e retorna o CEP formatado. */
export async function lookupCep(opts: {
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
}): Promise<string | null> {
  const uf = (opts.estado ?? "").trim().toUpperCase();
  const cidade = (opts.cidade ?? "").trim();
  const rua = streetOnly(opts.endereco) || (opts.bairro ?? "").trim();
  if (!UFS.has(uf) || cidade.length < 3 || rua.length < 3) return null;

  const key = `${uf}|${strip(cidade)}|${strip(rua)}|${strip(opts.bairro)}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(
      cidade,
    )}/${encodeURIComponent(rua)}/json/`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("viacep");
    const list = (await res.json()) as ViaCepItem[];
    if (!Array.isArray(list) || list.length === 0) {
      cache.set(key, null);
      return null;
    }
    const bairro = strip(opts.bairro);
    const hit =
      (bairro && list.find((i) => strip(i.bairro) === bairro)) ||
      (bairro && list.find((i) => strip(i.bairro).includes(bairro))) ||
      (list.length === 1 ? list[0] : null);
    const cep = hit?.cep ? String(hit.cep).replace(/\D/g, "") : "";
    const out = cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null;
    cache.set(key, out);
    return out;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/** Preenche o CEP dos registros que estão sem, usando endereço/bairro/cidade/UF. */
export async function fillMissingCeps<T extends NotaRecord>(
  records: T[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ records: T[]; filled: number; changed: T[] }> {
  const targets = records.filter((r) => !String(r.cep ?? "").trim());
  const changed: T[] = [];
  let done = 0;
  const out = [...records];

  const CONCURRENCY = 4;
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const rec = targets[cursor++];
      const cep = await lookupCep(rec);
      if (cep) {
        const idx = out.findIndex((r) => r === rec);
        const updated = { ...rec, cep } as T;
        if (idx >= 0) out[idx] = updated;
        changed.push(updated);
      }
      onProgress?.(++done, targets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  return { records: out, filled: changed.length, changed };
}
