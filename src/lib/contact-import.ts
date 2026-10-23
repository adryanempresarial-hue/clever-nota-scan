import type { NotaRecord } from "./nota.functions";
import { cleanCell, digitsOf, sanitizeRecord } from "./record-format";
import { mergeContactEmails, mergeContactPhones } from "./contact-values";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const SHEET_COLUMN_MAP: Record<string, keyof NotaRecord> = {
  dtultalteracao: "dtAlteracao", dtultimaalteracao: "dtAlteracao", ultimaalteracao: "dtAlteracao",
  dataultimaalteracao: "dtAlteracao", dtalteracao: "dtAlteracao", dataalteracao: "dtAlteracao",
  dtcadastro: "dtCadastro", datacadastro: "dtCadastro", cadastro: "dtCadastro", dtcad: "dtCadastro",
  nome: "nome", nomecompleto: "nome", razaosocial: "nome", cliente: "nome", nomefantasia: "nome",
  cpf: "cpf", cpfcnpj: "cpf", documento: "cpf",
  cnpj: "cnpj",
  email: "email", emails: "email", ementeeletronico: "email", correioeletronico: "email",
  enderecoeletronico: "email",
  uh: "uh", hub: "uh", apto: "uh", apartamento: "uh", unidade: "uh", unidadehabitacional: "uh", quarto: "uh", numerodauh: "uh",
  telefone: "telefone", celular: "telefone", fone: "telefone", whatsapp: "telefone", contato: "telefone",
  foneres: "telefone", fonecom: "telefone", foneresidencial: "telefone", fonecomercial: "telefone",
  telres: "telefone", telcom: "telefone", telefoneresidencial: "telefone", telefonecomercial: "telefone",
  telefonecelular: "telefone", fonecel: "telefone", telcel: "telefone",
  cep: "cep", codigopostal: "cep",
  endereco: "endereco", logradouro: "endereco", rua: "endereco",
  numero: "numero", num: "numero", n: "numero", nr: "numero", nro: "numero",
  numerodaresidencia: "numero", numeroresidencia: "numero", numeroendereco: "numero",
  numerodologradouro: "numero", numerodoimovel: "numero", endereconumero: "numero",
  bairro: "bairro",
  cidade: "cidade", municipio: "cidade",
  estado: "estado", uf: "estado",
  notafiscal: "notaFiscal", nf: "notaFiscal", numeronota: "notaFiscal",
  data: "data", dataemissao: "data",
  valor: "valor", valortotal: "valor", total: "valor",
};

// Sinônimos adicionais (busca por "contém", tolera variações de cabeçalho)
const SHEET_FUZZY: [RegExp, keyof NotaRecord][] = [
  [/(ultalteracao|ultimaalteracao|alteracao)/, "dtAlteracao"],
  [/(cadastro)/, "dtCadastro"],
  [/(hospede|hospedes|passageiro|titular|responsavel|locatario|inquilino|morador|proprietario|beneficiario|contratante|tomador|destinatario|favorecido|participante|convidado|aluno|paciente|funcionario|colaborador|socio|pessoa|nomerazao|razao|nome)/, "nome"],
  [/(cnpj)/, "cnpj"],
  [/(cpf|documento|doc|rgcpf)/, "cpf"],
  [/(mail)/, "email"],
  [/(tel|cel|fone|whats|zap)/, "telefone"],
  [/(cep)/, "cep"],
  [/^(?:numerod[oa]|nro|nr|n|numero)?(?:uh|hub|apto|apartamento|unidadehabitacional|unidade|quarto)(?:numero|nro|nr|hospede|cliente)?$/, "uh"],
  [/(^n$|^nr$|^nro$|numero|num|imovel)/, "numero"],
  [/(bairro)/, "bairro"],
  [/(cidade|municipio)/, "cidade"],
  [/(estado|^uf$)/, "estado"],
  [/(endereco|logradouro|rua|avenida)/, "endereco"],
  [/(notafiscal|^nf$|nfe|nota)/, "notaFiscal"],
  [/(dataemissao|emissao|checkin|data)/, "data"],
  [/(valor|total|preco)/, "valor"],
];

const FIRST_NAME_RE = /^(primeironome|nome1|firstname|prenome)$/;
const LAST_NAME_RE = /^(sobrenome|ultimonome|lastname|surname|nome2)$/;

function mapHeader(header: string): keyof NotaRecord | "firstName" | "lastName" | null {
  const n = norm(header);
  if (!n) return null;
  if (FIRST_NAME_RE.test(n)) return "firstName";
  if (LAST_NAME_RE.test(n)) return "lastName";
  if (SHEET_COLUMN_MAP[n]) return SHEET_COLUMN_MAP[n];
  for (const [re, key] of SHEET_FUZZY) if (re.test(n)) return key;
  return null;
}

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const looksLikeCpf = (v: string) => /^\d{11}$/.test(digitsOf(v)) && /[.\-\d]/.test(v);

const looksLikeCnpj = (v: string) => /^\d{14}$/.test(digitsOf(v));
const looksLikePhone = (v: string) => [10, 11].includes(digitsOf(v).length) && /[()\-\s]/.test(v);
const looksLikeCep = (v: string) => /^\d{5}-?\d{3}$/.test(v.trim());
const looksLikeDate = (v: string) => /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(v.trim());
const looksLikeName = (v: string) =>
  /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]{2,}$/.test(v.trim()) && /\s/.test(v.trim()) && !/\d/.test(v);

/** ---- Extratores tolerantes: acham o dado mesmo dentro de textos maiores ---- */
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const CPF_RE = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/;
const CNPJ_RE = /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b/;
const CEP_RE = /\b\d{5}[-.\s]?\d{3}\b/;
const PHONE_RE = /(\+?55\s?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}\b/;

const findIn = (cells: string[], re: RegExp, reject?: (v: string) => boolean) => {
  for (const cell of cells) {
    if (reject?.(cell)) continue;
    const m = cell.match(re);
    if (m) return m[0];
  }
  return "";
};

/** Nome tolerante: aceita CAIXA ALTA, acentos e nomes de uma palavra longa. */
const nameScore = (v: string) => {
  const s = v.trim();
  if (!s || /\d/.test(s) || /@/.test(s)) return 0;
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\-\s]*$/.test(s)) return 0;
  const words = s.split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return 0;
  if (s.length < 3) return 0;
  // evita rótulos genéricos
  if (/^(sim|nao|não|total|ativo|inativo|masculino|feminino|brasil|brasileiro|brasileira|solteiro|casado|cliente|hospede|hóspede)$/i.test(s))
    return 0;
  return words.length >= 2 ? 3 : 1;
};

/** Cabeçalhos: procura a melhor linha e junta com a linha seguinte (cabeçalho em 2 níveis). */
const isHeaderCell = (value: string) => {
  const n = norm(value);
  return Boolean(n && mapHeader(value) && (mapHeader(value) === "uh" || SHEET_COLUMN_MAP[n] || FIRST_NAME_RE.test(n) || LAST_NAME_RE.test(n) || /^(?:nome|hospede|cpf|cnpj|email|telefone|fone|celular|cep|endereco|numero|uh|hub|apto|apartamento|unidade|dt|data|bairro|cidade|estado)/.test(n)));
};

function findHeaderRow(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 40);
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < limit; i++) {
    const nonempty = (matrix[i] ?? []).map(c => cleanCell(c)).filter(Boolean);
    if (!nonempty.length || !nonempty.every(isHeaderCell)) continue;
    const score = (matrix[i] ?? []).reduce<number>(
      (acc, c) => acc + (isHeaderCell(String(c ?? "")) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = i;
      break;
    }
  }
  return best;
}

function buildHeaders(matrix: unknown[][], headerRow: number): string[] {
  if (headerRow < 0) return [];
  const main = (matrix[headerRow] ?? []).map((c) => String(c ?? "").trim());
  const next = (matrix[headerRow + 1] ?? []).map((c) => String(c ?? "").trim());
  // cabeçalho em 2 linhas: completa colunas vazias com o texto da linha de baixo
  const nextIsHeader =
    next.length > 0 &&
    next.filter(Boolean).every((c) => isHeaderCell(c));
  const width = Math.max(main.length, next.length);
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const a = main[i] ?? "";
    const b = nextIsHeader ? (next[i] ?? "") : "";
    out.push(a && b && a !== b ? `${a} ${b}` : a || b);
  }
  return out;
}

export function parseContactMatrix(matrix: unknown[][], source: string): NotaRecord[] {
  const out: NotaRecord[] = [];
    if (!matrix.length) return [];

    const headerRow = findHeaderRow(matrix);
    const headers = buildHeaders(matrix, headerRow);
    const keys = headers.map(mapHeader);

    const dataRows = matrix.slice(headerRow >= 0 ? headerRow + 1 : 0);

    dataRows.forEach((row, i) => {
      const allCells = row.map((c) => cleanCell(c)).filter(Boolean);
      if (!allCells.length) return;
      // ignora repetições do cabeçalho no meio da planilha
      if (allCells.every(isHeaderCell)) return;

      const rec: NotaRecord = {
        _arquivo: `${source} · linha ${(headerRow >= 0 ? headerRow + 2 : 1) + i}`,
      };
      let filled = 0;
      let first = "";
      let last = "";
      const leftovers: string[] = [];
      const phones: string[] = [];
      const emails: string[] = [];
      const nameCandidates: string[] = [];

      row.forEach((cell, c) => {
        const val = cleanCell(cell);
        if (!val) return;
        const key = keys[c] ?? null;
        if (key === "firstName") {
          first = val;
          return;
        }
        if (key === "lastName") {
          last = val;
          return;
        }
        if (!key) {
          leftovers.push(val);
          return;
        }
        // Fone Res / Fone Com / Celular: guarda todos e escolhe o melhor depois
        if (key === "telefone") {
          phones.push(val);
          return;
        }
        if (key === "email") { emails.push(val); return; }
        // Coluna "CPF/CNPJ": decide pelo tamanho do documento
        if (key === "cpf" && digitsOf(val).length > 11) {
          if (!rec.cnpj) {
            rec.cnpj = val;
            filled++;
          }
          return;
        }
        if (key === "nome") {
          nameCandidates.push(val);
          return;
        }
        if ((rec as Record<string, unknown>)[key]) return;
        (rec as Record<string, unknown>)[key] = val;
        filled++;
      });

      // Nome: junta colunas de nome (Nome + Sobrenome / Razão + Fantasia) sem duplicar
      if (nameCandidates.length) {
        const seen = new Set<string>();
        const joined = nameCandidates
          .filter((n) => {
            const k = norm(n);
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .join(" ")
          .trim();
        if (joined) {
          rec.nome = joined;
          filled++;
        } else {
          leftovers.push(...nameCandidates);
        }
      }

      if (phones.length) {
        rec.telefone = mergeContactPhones(phones);
        filled++;
      }
      if (emails.length) {
        rec.email = mergeContactEmails(emails);
        filled++;
      }

      if (!rec.nome && (first || last)) {
        rec.nome = [first, last].filter(Boolean).join(" ");
        filled++;
      }

      // Inferência por conteúdo para colunas sem cabeçalho reconhecido
      for (const val of leftovers) {
        if (!rec.email && looksLikeEmail(val)) rec.email = val;
        else if (!rec.cpf && looksLikeCpf(val)) rec.cpf = val;
        else if (!rec.cnpj && looksLikeCnpj(val)) rec.cnpj = val;
        else if (!rec.cep && looksLikeCep(val)) rec.cep = val;
        else if (!rec.telefone && looksLikePhone(val)) rec.telefone = val;
        else if (!rec.dtCadastro && looksLikeDate(val) && rec.dtAlteracao) rec.dtCadastro = val;
        else if (!rec.dtAlteracao && looksLikeDate(val)) rec.dtAlteracao = val;
        else if (!rec.nome && looksLikeName(val)) rec.nome = val;
        else continue;
        filled++;
      }

      const unidentified = row.map((cell, column) => keys[column] ? "" : cleanCell(cell)).filter(Boolean);
      // Varredura final: força a captação dos campos-chave em QUALQUER célula da linha
      if (!rec.nome) {
        const ranked = unidentified
          .map((v) => ({ v, s: nameScore(v) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || b.v.length - a.v.length);
        if (ranked.length) {
          rec.nome = ranked[0]?.v ?? "";
          filled++;
        }
      }
      if (!rec.email) {
        const v = mergeContactEmails(unidentified, false);
        if (v) {
          rec.email = v;
          filled++;
        }
      }
      if (!rec.cpf) {
        const v =
          findIn(unidentified, CPF_RE, (x) => /@/.test(x)) ||
          unidentified.find((x) => !/@/.test(x) && digitsOf(x).length === 11 && !looksLikeDate(x)) ||
          // planilha cortou zeros à esquerda: 9 ou 10 dígitos puros
          unidentified.find(
            (x) => /^\d{9,10}$/.test(x.trim()) && !looksLikeDate(x) && x.trim() !== rec.numero,
          ) ||
          "";
        if (v) {
          rec.cpf = v;
          filled++;
        }
      }
      if (!rec.cnpj) {
        const v = findIn(unidentified, CNPJ_RE, (x) => /@/.test(x));
        if (v) {
          rec.cnpj = v;
          filled++;
        }
      }
      if (!rec.cep) {
        const v =
          unidentified.find(looksLikeCep) ||
          findIn(unidentified, CEP_RE, (x) => /@/.test(x) || looksLikeDate(x)) ||
          "";
        if (v) {
          rec.cep = v;
          filled++;
        }
      }
      if (!rec.telefone) {
        const v = findIn(
          unidentified,
          PHONE_RE,
          (x) => looksLikeEmail(x) || looksLikeDate(x) || x === rec.cpf || x === rec.cep,
        );
        if (v) {
          rec.telefone = v;
          filled++;
        }
      }

      // Mantém a linha mesmo se só houver 1 dado — 107 contatos = 107 registros
      if (filled > 0 || allCells.length >= 2) out.push(sanitizeRecord(rec));
    });
  return out;
}

export async function parseSheetRecords(file: File): Promise<NotaRecord[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, cellText: true });
  return wb.SheetNames.flatMap(sheetName => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return [];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true });
    return parseContactMatrix(matrix, `${file.name} — ${sheetName}`);
  });
}
