import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { loadAllFiscalRuns } from "@/lib/fiscal-reader-store";
import { scannedSearch, scannedCopyText } from "@/lib/scanned-search";
import { ImportDateFilter } from "@/components/ImportDateFilter";
import type { ImportDates } from "@/lib/import-dates";
import {
  Upload,
  FileText,
  Copy,
  CheckCheck,
  Download,
  Trash2,
  Loader2,
  Mail,
  FileSpreadsheet,
  FileType,
  FileImage,
  History,
  Sparkles,
  X,
  Pencil,
  Check,
  Smartphone,
  LogOut,
  Cloud,
  Calendar,
  Phone,
  Users,
  ScanLine,
  Search,
  CalendarDays,
  MapPin,
  AtSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractFromFiles, type NotaRecord } from "@/lib/nota.functions";
import { cleanCell, digitsOf, formatPhone, isValidPhone, maskPhoneInput, sanitizeRecord } from "@/lib/record-format";
import { useCloudRecords, useCloudFiles, signOut, type CloudFile } from "@/lib/nota-sync";
import { fillMissingCeps } from "@/lib/cep-lookup";
import { extractFullFromFile } from "@/lib/crm.functions";
import { useCrmRecords, type CrmRecord } from "@/lib/crm-sync";
import ContactsTab from "@/components/ContactsTab";
import { FiscalTab } from "@/components/FiscalTab";
import { Calculator } from "lucide-react";
import { ContaAzulTab } from "@/components/ContaAzulTab";
import { EmailCrmTab } from "@/components/EmailCrmTab";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "NOTA · D4S — Extração inteligente de notas fiscais" },
      {
        name: "description",
        content:
          "Extraia automaticamente nome, CPF, CNPJ, e-mail, endereço e valores de notas fiscais e comprovantes com IA + OCR.",
      },
      { property: "og:title", content: "NOTA · D4S" },
      {
        property: "og:description",
        content: "Extração inteligente de notas fiscais e comprovantes com IA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotaTool,
});

const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.csv,.ods";
const SHEET_EXT = /\.(xlsx|xls|xlsm|csv|ods)$/i;
const isSheet = (f: File) => SHEET_EXT.test(f.name);

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
  telefone: "telefone", celular: "telefone", fone: "telefone", whatsapp: "telefone", contato: "telefone",
  foneres: "telefone", fonecom: "telefone", foneresidencial: "telefone", fonecomercial: "telefone",
  telres: "telefone", telcom: "telefone", telefoneresidencial: "telefone", telefonecomercial: "telefone",
  telefonecelular: "telefone", fonecel: "telefone", telcel: "telefone",
  cep: "cep", codigopostal: "cep",
  endereco: "endereco", logradouro: "endereco", rua: "endereco",
  numero: "numero", num: "numero", n: "numero", nr: "numero", nro: "numero",
  numerodaresidencia: "numero", numeroresidencia: "numero", numeroendereco: "numero",
  numerodologradouro: "numero", numerodoimovel: "numero", enderecoNumero: "numero",
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
  [/(^n$|^nr$|^nro$|apto|apartamento|unidade|quarto|uh|hub|numero|num|imovel)/, "numero"],
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
function findHeaderRow(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 40);
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < limit; i++) {
    const score = (matrix[i] ?? []).reduce<number>(
      (acc, c) => acc + (mapHeader(String(c ?? "")) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = i;
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
    next.some((c) => c && mapHeader(c)) &&
    next.filter((c) => c && looksLikeName(c)).length === 0;
  const width = Math.max(main.length, next.length);
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const a = main[i] ?? "";
    const b = nextIsHeader ? (next[i] ?? "") : "";
    out.push(a && b && a !== b ? `${a} ${b}` : a || b);
  }
  return out;
}

// Lê planilhas (xlsx/xls/csv/ods) no navegador: cada linha vira um registro
async function parseSheetRecords(file: File): Promise<NotaRecord[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const out: NotaRecord[] = [];

  for (const sheetName of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    if (!matrix.length) continue;

    const headerRow = findHeaderRow(matrix);
    const headers = buildHeaders(matrix, headerRow);
    const keys = headers.map(mapHeader);
    const headerSignature = headers.map((h) => norm(h)).filter(Boolean).join("|");
    const dataRows = matrix.slice(headerRow >= 0 ? headerRow + 1 : 0);

    dataRows.forEach((row, i) => {
      const allCells = row.map((c) => cleanCell(c)).filter(Boolean);
      if (!allCells.length) return;
      // ignora repetições do cabeçalho no meio da planilha
      const sig = row.map((c) => norm(String(c ?? ""))).filter(Boolean).join("|");
      if (sig && sig === headerSignature) return;

      const rec: NotaRecord = {
        _arquivo: `${file.name} — ${sheetName} · linha ${(headerRow >= 0 ? headerRow + 2 : 1) + i}`,
      };
      let filled = 0;
      let first = "";
      let last = "";
      const leftovers: string[] = [];
      const phones: string[] = [];
      const nameCandidates: string[] = [];

      row.forEach((cell, c) => {
        const val = cleanCell(cell);
        if (!val) return;
        if (/^(uh|hub|apto|apartamento|numerodauh|unidadehabitacional|quarto)$/.test(norm(headers[c] ?? ""))) rec.uh = val;
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
            return nameScore(n) > 0;
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
        const best =
          phones.find((p) => digitsOf(p).length === 11) ??
          phones.find((p) => digitsOf(p).length === 10) ??
          phones.find((p) => digitsOf(p).length >= 8) ??
          phones[0];
        rec.telefone = best;
        filled++;
        for (const p of phones) if (p !== best) leftovers.push(p);
      }

      if (first || last) {
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

      // Varredura final: força a captação dos campos-chave em QUALQUER célula da linha
      if (!rec.nome) {
        const ranked = allCells
          .map((v) => ({ v, s: nameScore(v) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || b.v.length - a.v.length);
        if (ranked.length) {
          rec.nome = ranked[0]!.v;
          filled++;
        }
      }
      if (!rec.email) {
        const v = findIn(allCells, EMAIL_RE);
        if (v) {
          rec.email = v;
          filled++;
        }
      }
      if (!rec.cpf) {
        const v =
          findIn(allCells, CPF_RE, (x) => /@/.test(x)) ||
          allCells.find((x) => !/@/.test(x) && digitsOf(x).length === 11 && !looksLikeDate(x)) ||
          // planilha cortou zeros à esquerda: 9 ou 10 dígitos puros
          allCells.find(
            (x) => /^\d{9,10}$/.test(x.trim()) && !looksLikeDate(x) && x.trim() !== rec.numero,
          ) ||
          "";
        if (v) {
          rec.cpf = v;
          filled++;
        }
      }
      if (!rec.cnpj) {
        const v = findIn(allCells, CNPJ_RE, (x) => /@/.test(x));
        if (v) {
          rec.cnpj = v;
          filled++;
        }
      }
      if (!rec.cep) {
        const v =
          allCells.find(looksLikeCep) ||
          findIn(allCells, CEP_RE, (x) => /@/.test(x) || looksLikeDate(x)) ||
          "";
        if (v) {
          rec.cep = v;
          filled++;
        }
      }
      if (!rec.telefone) {
        const v = findIn(
          allCells,
          PHONE_RE,
          (x) => looksLikeEmail(x) || looksLikeDate(x) || x === rec.cpf || x === rec.cep,
        );
        if (v) {
          rec.telefone = v;
          filled++;
        }
      }
      if (!rec.numero) {
        const v = allCells.find((x) => /^\d{1,5}$/.test(x.trim()));
        if (v) {
          rec.numero = v;
          filled++;
        }
      }

      // Mantém a linha mesmo se só houver 1 dado — 107 contatos = 107 registros
      if (filled > 0 || allCells.length >= 2) out.push(sanitizeRecord(rec));
    });
  }
  return out;
}


const MAX_FILES = 10;

// Ordem FIXA de campos extraídos e exibidos em todos os documentos
const FIELD_ORDER = ["nome", "cpf", "telefone", "email", "cep", "numero"] as const;
type FieldKey = (typeof FIELD_ORDER)[number];
const FIELD_LABELS: Record<FieldKey, string> = {
  nome: "Nome",
  cpf: "CPF",
  telefone: "Telefone",
  email: "E-mail",
  cep: "CEP",
  numero: "Número",
};

type ExportKind = "docx" | "xlsx" | "pdf";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      resolve(r.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function nextVersionedName(base: string, ext: ExportKind, existing: { name: string; kind: ExportKind }[]) {
  const prefix = `${base}_`;
  const used = existing
    .filter((h) => h.kind === ext && h.name.startsWith(prefix))
    .map((h) => {
      const m = h.name.match(/_(\d{3})\./);
      return m ? parseInt(m[1]!, 10) : 0;
    });
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${base}_${String(next).padStart(3, "0")}.${ext}`;
}

/** Número do apartamento (HUB): 21 → 612; 200 sempre por último. */
function apartmentNumber(r: NotaRecord): number | null {
  const raw = String(r.numero ?? "").match(/\d+/);
  if (!raw) return null;
  const n = parseInt(raw[0], 10);
  return Number.isFinite(n) ? n : null;
}

function sortByApartment<T extends NotaRecord>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const na = apartmentNumber(a);
    const nb = apartmentNumber(b);
    const rank = (n: number | null) => (n === 200 ? 2 : n === null ? 1 : 0);
    const ra = rank(na);
    const rb = rank(nb);
    if (ra !== rb) return ra - rb;
    if (ra !== 0) return 0;
    return (na as number) - (nb as number);
  });
}

/** ---- Agrupamento por período de hospedagem (datas do topo) ---- */
function parseBrDate(v?: string | null): Date | null {
  const s = String(v ?? "").trim();
  const m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y!.length === 2 ? 2000 + parseInt(y!, 10) : parseInt(y!, 10);
  const dt = new Date(year, parseInt(mo!, 10) - 1, parseInt(d!, 10));
  return isNaN(dt.getTime()) ? null : dt;
}
const fmtBr = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** Extrai o período (Dt. Cadastro / Dt. Ult. Alteração) de um registro. */
function periodOf(r: NotaRecord): { key: string; label: string; start: number } {
  const dates = [r.dtCadastro, r.dtAlteracao, r.data]
    .map(parseBrDate)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length === 0) return { key: "sem-data", label: "Sem data", start: Infinity };
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const label =
    first.getTime() === last.getTime() ? fmtBr(first) : `${fmtBr(first)} - ${fmtBr(last)}`;
  return { key: label, label, start: first.getTime() };
}

function groupByPeriod<T extends NotaRecord>(list: T[]) {
  const map = new Map<string, { label: string; start: number; items: T[] }>();
  for (const r of list) {
    const p = periodOf(r);
    const g = map.get(p.key) ?? { label: p.label, start: p.start, items: [] as T[] };
    g.items.push(r);
    map.set(p.key, g);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

function NotaTool() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [autoProcess, setAutoProcess] = useState(true);
  const [forceReprocess, setForceReprocess] = useState(false);
  const pendingAutoRef = useRef(false);
  const pendingCepSweepRef = useRef(false);
  const {
    records: rawRecords,
    loading: loadingRecords,
    syncing: syncingRecords,
    addMany,
    removeOne,
    clearAll,
    updateFields,
  } = useCloudRecords();
  // Ordena por número do apartamento (HUB): 21 → 612, e o 200 sempre por último
  const records = useMemo(() => sortByApartment(rawRecords), [rawRecords]);
  const {
    files: cloudFiles,
    loading: loadingFiles,
    syncing: syncingFiles,
    saveFile,
    downloadFile,
    removeFile,
  } = useCloudFiles();
  const syncing = syncingRecords || syncingFiles;
  const loadingCloud = loadingRecords || loadingFiles;
  const [exportDialog, setExportDialog] = useState<{
    kind: ExportKind;
    emailsOnly: boolean;
  } | null>(null);
  const [exportMode, setExportMode] = useState<"new" | "append">("new");
  

  const inputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const extract = useServerFn(extractFromFiles);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const valid = arr.filter((f) => ACCEPTED.includes(f.type) || isSheet(f));
    const rejected = arr.length - valid.length;
    if (rejected > 0) toast.error(`${rejected} arquivo(s) com formato não suportado`);
    setFiles((prev) => {
      const merged = [...prev, ...valid].slice(0, MAX_FILES);
      if (prev.length + valid.length > MAX_FILES)
        toast.warning(`Máximo de ${MAX_FILES} arquivos por vez`);
      return merged;
    });
    if (autoProcess && valid.length > 0) pendingAutoRef.current = true;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const handleProcess = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(5);
    const tick = setInterval(() => setProgress((p) => Math.min(90, p + 5)), 600);
    try {
      const sheets = files.filter(isSheet);
      const docs = files.filter((f) => !isSheet(f));
      const collected: NotaRecord[] = [];

      for (const f of sheets) {
        collected.push(...(await parseSheetRecords(f)));
      }

      if (docs.length > 0) {
        const payload = await Promise.all(
          docs.map(async (f) => ({
            name: f.name,
            mimeType: f.type,
            dataBase64: await fileToBase64(f),
          })),
        );
        const res = await extract({ data: { files: payload } });
        collected.push(...res.records.map((r) => sanitizeRecord(r as NotaRecord)));
      }

      if (collected.length === 0) throw new Error("Nenhum dado encontrado nos arquivos");
      console.log("[NOTA] SAVED_DATA", collected);
      // Preenche CEP faltante pelo endereço/bairro/cidade/UF antes de salvar
      const withCep = await fillMissingCeps(collected);
      setProgress(100);
      // Correção automática dos telefones (sem confirmação) e gravação direta
      const finalRecords = withCep.records.map((r) => {
        const raw = String(r.telefone ?? "").trim();
        const fixed = raw ? formatPhone(raw) : "";
        return { ...r, telefone: fixed && isValidPhone(fixed) ? fixed : null };
      });
      const res = await addMany(finalRecords, { force: forceReprocess });
      const parts = [
        `${finalRecords.length} linha(s) lida(s)`,
        res?.inserted ? `${res.inserted} novo(s)` : "",
        res?.updated ? `${res.updated} atualizado(s)` : "",
        res?.skipped ? `${res.skipped} duplicado(s) ignorado(s)` : "",
        withCep.filled ? `${withCep.filled} CEP(s) identificado(s)` : "",
      ].filter(Boolean);
      toast.success(parts.join(" · "));
      pendingCepSweepRef.current = true;
      setFiles([]);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao processar";
      toast.error(msg);
    } finally {
      clearInterval(tick);
      setProcessing(false);
      setTimeout(() => setProgress(0), 1200);
    }
  };

  // Leitura instantânea: dispara extração automaticamente ao adicionar arquivos
  useEffect(() => {
    if (!pendingAutoRef.current) return;
    if (processing) return;
    if (files.length === 0) return;
    pendingAutoRef.current = false;
    handleProcess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, processing]);

  const [cepRunning, setCepRunning] = useState(false);
  const [cepProgress, setCepProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFillCeps = async () => {
    const pending = records.filter((r) => !String(r.cep ?? "").trim());
    if (pending.length === 0) return toast.info("Todos os registros já têm CEP");
    setCepRunning(true);
    setCepProgress({ done: 0, total: pending.length });
    try {
      const res = await fillMissingCeps(records, (done, total) =>
        setCepProgress({ done, total }),
      );
      let saved = 0;
      for (const rec of res.changed) {
        if (rec._id && rec.cep) {
          await updateFields(rec._id, { cep: rec.cep });
          saved++;
        }
      }
      toast.success(
        saved
          ? `${saved} CEP(s) identificado(s) de ${pending.length} sem CEP`
          : "Nenhum CEP encontrado para os endereços disponíveis",
      );
    } catch {
      toast.error("Falha ao consultar CEPs");
    } finally {
      setCepRunning(false);
      setCepProgress(null);
    }
  };

  // Após cada importação, varre a base salva e identifica os CEPs faltantes
  useEffect(() => {
    if (!pendingCepSweepRef.current) return;
    if (processing || loadingRecords || cepRunning) return;
    if (records.length === 0) return;
    pendingCepSweepRef.current = false;
    if (!records.some((r) => !String(r.cep ?? "").trim())) return;
    void handleFillCeps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, processing, loadingRecords, cepRunning]);

  const allEmails = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.email && set.add(r.email));
    return Array.from(set);
  }, [records]);

  const openExport = (kind: ExportKind, emailsOnly = false) => {
    if (processing) return toast.error("Aguarde o processamento terminar");
    if (records.length === 0) return toast.error("Processe documentos primeiro");
    if (emailsOnly && allEmails.length === 0) return toast.error("Nenhum e-mail encontrado");
    setExportMode("new");
    setExportDialog({ kind, emailsOnly });
  };

  const doExport = async () => {
    if (!exportDialog) return;
    const { kind, emailsOnly } = exportDialog;
    if (records.length === 0) {
      toast.error("Nenhum dado para exportar");
      return;
    }
    const base = emailsOnly ? "emails" : "clientes";
    const name = nextVersionedName(base, kind, cloudFiles);
    try {
      const data = emailsOnly
        ? allEmails.map((e) => ({ _arquivo: "", email: e }) as NotaRecord)
        : records;
      console.log(`[NOTA] EXPORT_${kind.toUpperCase()}_DATA`, data);
      let blob: Blob;
      if (kind === "xlsx") blob = await buildXlsx(data, emailsOnly);
      else if (kind === "pdf") blob = await buildPdf(data, emailsOnly);
      else blob = await buildDocx(data, emailsOnly);
      downloadBlob(blob, name);
      await saveFile(blob, name, kind, data.length);
      toast.success(`Arquivo gerado: ${name}`);
      setExportDialog(null);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar arquivo");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", search: { redirect: undefined } });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30">
      <Toaster richColors position="top-right" />
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold">
              D4S
            </div>
            <div>
              <div className="font-semibold text-foreground flex items-center gap-2">
                NOTA <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="text-xs text-muted-foreground">Extração inteligente com IA + OCR</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {syncing ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sincronizando…
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-primary"
                title="Dados sincronizados na nuvem"
              >
                <Cloud className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sincronizado</span>
              </span>
            )}
            <Link
              to="/mobile"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
              title="Abrir scanner mobile"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Scanner Mobile</span>
            </Link>
            <Link
              to="/download"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
              title="Baixar como aplicativo"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Baixar app</span>
            </Link>
            <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary font-medium hidden sm:inline">
              Plano Empresarial
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut} title="Sair">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="min-w-0 max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Tabs defaultValue="processar" className="space-y-6">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="processar">
              <FileText className="w-4 h-4 mr-2" />
              Processar
            </TabsTrigger>
            <TabsTrigger value="salvos">
              <FileImage className="w-4 h-4 mr-2" />
              Salvos{loadingCloud ? "" : ` (${records.length})`}
            </TabsTrigger>
            <TabsTrigger value="fichas">
              <Users className="w-4 h-4 mr-2" />
              Fichas
            </TabsTrigger>
            <TabsTrigger value="emails">
              <Mail className="w-4 h-4 mr-2" />
              E-mails
            </TabsTrigger>
            <TabsTrigger value="numeros">
              <Phone className="w-4 h-4 mr-2" />
              Números
            </TabsTrigger>
            <TabsTrigger value="fiscal">
              <Calculator className="w-4 h-4 mr-2" />
              Cálculo Fiscal
            </TabsTrigger>
            <TabsTrigger value="crm">
              <Users className="w-4 h-4 mr-2" />
              CRM
            </TabsTrigger>
            <TabsTrigger value="contaazul">
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Importação Conta Azul
            </TabsTrigger>
            <TabsTrigger value="crmemail">
              <AtSign className="w-4 h-4 mr-2" />
              CRM E-mail
            </TabsTrigger>
            <TabsTrigger value="historico">
              <History className="w-4 h-4 mr-2" />
              Arquivos Gerados{loadingCloud ? "" : ` (${cloudFiles.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="processar" className="space-y-6">
            <QuickSnippets notaRecords={records} />
            <Card
              className="p-8 border-dashed border-2 hover:border-primary/50 transition-colors cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
              <div className="text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-primary/10 mx-auto flex items-center justify-center">
                  <Upload className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Arraste seus documentos ou clique para selecionar
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Até 10 arquivos · JPG, JPEG, PNG, WEBP, PDF, XLSX, XLS, CSV, ODS
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Planilhas são lidas linha a linha (cada linha vira um registro)
                  </p>
                </div>
                <div className="pt-1">
                  <input
                    ref={sheetInputRef}
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.xlsm,.csv,.ods"
                    className="hidden"
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                  <Button
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      sheetInputRef.current?.click();
                    }}
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Importar planilha (XLSX, XLS, CSV, ODS)
                  </Button>
                </div>
              </div>
            </Card>

            {files.length > 0 && (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {files.length} arquivo(s) selecionado(s)
                  </span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoProcess}
                        onChange={(e) => setAutoProcess(e.target.checked)}
                        className="accent-primary"
                      />
                      Leitura instantânea
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={forceReprocess}
                        onChange={(e) => setForceReprocess(e.target.checked)}
                        className="accent-primary"
                      />
                      Forçar reprocessamento
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFiles([])}
                      disabled={processing}
                    >
                      Limpar
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <span
                      key={i}
                      className="text-xs px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground flex items-center gap-2"
                    >
                      <FileImage className="w-3 h-3" />
                      {f.name}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiles((p) => p.filter((_, j) => j !== i));
                        }}
                        disabled={processing}
                      >
                        <X className="w-3 h-3 hover:text-destructive" />
                      </button>
                    </span>
                  ))}
                </div>
                {processing && (
                  <div className="space-y-2">
                    <Progress value={progress} />
                    <p className="text-xs text-muted-foreground text-center">
                      Processando com IA + OCR...
                    </p>
                  </div>
                )}
                <Button
                  onClick={handleProcess}
                  disabled={processing}
                  className="w-full"
                  size="lg"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Extrair dados
                    </>
                  )}
                </Button>
              </Card>
            )}

            {records.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">
                    Resultados ({records.length})
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleFillCeps}
                      disabled={cepRunning}
                    >
                      {cepRunning ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <MapPin className="w-4 h-4 mr-2" />
                      )}
                      {cepRunning && cepProgress
                        ? `CEP ${cepProgress.done}/${cepProgress.total}`
                        : "Identificar CEP faltante"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openExport("docx")}>
                      <FileType className="w-4 h-4 mr-2" /> Word
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openExport("xlsx")}>
                      <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openExport("pdf")}>
                      <FileText className="w-4 h-4 mr-2" /> PDF
                    </Button>
                    <Button size="sm" onClick={() => openExport("xlsx", true)}>
                      <Mail className="w-4 h-4 mr-2" /> Exportar apenas E-mails
                    </Button>
                  </div>
                </div>

                {groupByPeriod(records).map((g) => (
                  <div key={g.label} className="space-y-3">
                    <div className="flex items-center gap-2 border-b pb-2">
                      <CalendarDays className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">{g.label}</span>
                      <span className="text-xs text-muted-foreground">
                        ({g.items.length})
                      </span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {g.items.map((r, idx) => (
                        <RecordCard key={r._id ?? `${g.label}-${idx}`} record={r} />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="salvos" className="space-y-4">
            {records.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <FileImage className="w-10 h-10 mx-auto mb-3 opacity-50" />
                Nenhum registro salvo ainda. Processe documentos na aba "Processar".
              </Card>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">
                    {records.length} registro(s) salvo(s)
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => openExport("docx")}>
                      <FileType className="w-4 h-4 mr-2" /> Word
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openExport("xlsx")}>
                      <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openExport("pdf")}>
                      <FileText className="w-4 h-4 mr-2" /> PDF
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm("Remover todos os registros salvos?")) {
                          clearAll().then(() => toast.success("Registros removidos"));
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Limpar todos
                    </Button>
                  </div>
                </div>
                {groupByPeriod(records).map((g) => (
                  <div key={g.label} className="space-y-3">
                    <div className="flex items-center gap-2 border-b pb-2">
                      <CalendarDays className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">{g.label}</span>
                      <span className="text-xs text-muted-foreground">
                        ({g.items.length})
                      </span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {g.items.map((r) => (
                        <RecordCard
                          key={r._id ?? r._arquivo}
                          record={r}
                          onDelete={() => removeOne(r._id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="fichas">
            <ContactsTab records={records} onUpdate={updateFields} onRestore={addMany} />
          </TabsContent>

          <TabsContent value="emails">
            <EmailsTab records={records} onSaveFile={saveFile} onUpdateEmail={updateFields} />
          </TabsContent>

          <TabsContent value="numeros">
            <PhonesTab records={records} onSaveFile={saveFile} onUpdatePhone={updateFields} />
          </TabsContent>

          <TabsContent value="fiscal">
            <FiscalTab onSaveFile={saveFile} />
          </TabsContent>

          <TabsContent value="crm">
            <CrmTab />
          </TabsContent>

          <TabsContent value="contaazul">
            <ContaAzulTab />
          </TabsContent>

          <TabsContent value="crmemail">
            <EmailCrmTab />
          </TabsContent>

          <TabsContent value="historico">
            {cloudFiles.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <History className="w-10 h-10 mx-auto mb-3 opacity-50" />
                Nenhum arquivo gerado ainda.
              </Card>
            ) : (
              <Card className="divide-y">
                {cloudFiles.map((f: CloudFile) => (
                  <div
                    key={f.id}
                    className="p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{f.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(f.created_at).toLocaleString("pt-BR")} · {f.count} registro(s)
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          downloadFile(f).catch(() => toast.error("Falha ao baixar"))
                        }
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(f)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>




      <Dialog open={!!exportDialog} onOpenChange={(o) => !o && setExportDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exportar arquivo</DialogTitle>
            <DialogDescription>
              Os arquivos existentes nunca são substituídos. Uma nova versão será criada.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={exportMode}
            onValueChange={(v) => setExportMode(v as "new" | "append")}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="new" id="new" />
              <Label htmlFor="new">Criar novo arquivo</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="append" id="append" />
              <Label htmlFor="append">
                Adicionar ao existente (gera nova versão)
              </Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialog(null)}>
              Cancelar
            </Button>
            <Button onClick={doExport}>
              <Download className="w-4 h-4 mr-2" /> Gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecordCard({ record, onDelete }: { record: NotaRecord; onDelete?: () => void }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const entries = FIELD_ORDER.map((k) => [k, record[k]] as const);

  const copyAll = async () => {
    const text = [
      `Dt. Ult. Alteração: ${record.dtAlteracao ?? ""}`,
      `Dt. Cadastro: ${record.dtCadastro ?? ""}`,
      ...entries.map(([k, v]) => `${FIELD_LABELS[k]}: ${v ?? ""}`),
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
    toast.success("Copiado");
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="min-w-0 flex-1">
          {record.nome ? (
            <div className="font-semibold text-foreground break-words">{record.nome}{record.uh && ` ( UH ${record.uh} )`}</div>
          ) : (
            <div className="font-semibold text-muted-foreground italic">Sem nome identificado</div>
          )}
          <span className="text-xs text-muted-foreground truncate block">{record._arquivo}</span>
        </div>
        <Button size="sm" variant="outline" onClick={copyAll}>
          {copiedAll ? (
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
          ) : (
            <Copy className="w-3.5 h-3.5 mr-1.5" />
          )}
          Copiar tudo
        </Button>
        {onDelete && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            aria-label="Remover registro"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/60 px-3 py-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Dt. Ult. Alteração</div>
          <div className="text-sm font-medium">{record.dtAlteracao || "—"}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Dt. Cadastro</div>
          <div className="text-sm font-medium">{record.dtCadastro || "—"}</div>
        </div>
      </div>
      <div className="space-y-2">
        {entries.map(([k, v]) => (
          <FieldRow key={k} label={FIELD_LABELS[k]} value={v ? String(v) : "—"} />
        ))}
      </div>
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 rounded hover:bg-muted/50 px-2 -mx-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium text-foreground break-words">{value}</div>
      </div>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="text-muted-foreground hover:text-primary p-1 rounded transition-colors"
        aria-label={`Copiar ${label}`}
      >
        {copied ? <CheckCheck className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ---------- Exportadores ----------

const FIXED_NUMBERS: { label: string; value: string }[] = [
  { label: "Código 1", value: "1180521" },
  { label: "Código 2", value: "200048" },
  { label: "Código 3", value: "050201" },
];

const DEFAULT_MESSAGE =
  "Prestação de Serviços de Hotelaria – Período: 19 à 21 de Junho de 2026";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* segue para o fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({
  value,
  label,
  text,
}: {
  value: string;
  label?: string;
  text?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        if (!(await copyToClipboard(value))) {
          toast.error("Não foi possível copiar");
          return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
        toast.success("Copiado");
      }}
      aria-label={`Copiar ${label ?? "valor"}`}
    >
      {copied ? (
        <CheckCheck className="w-4 h-4" />
      ) : (
        <Copy className={text ? "w-4 h-4 mr-2" : "w-4 h-4"} />
      )}
      {text && <span className="whitespace-nowrap">{text}</span>}
    </Button>
  );
}

function QuickSnippets({
  notaRecords,
}: {
  notaRecords: (NotaRecord & { _id?: string; _createdAt?: string })[];
}) {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [editing, setEditing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { records: crmRecords } = useCrmRecords();
  const [query, setQuery] = useState("");

  const [importDates, setImportDates] = useState<ImportDates>({});

  const fiscalHistory = useQuery({
    queryKey: ["quick-search-fiscal-history"],
    queryFn: loadAllFiscalRuns,
    enabled: query.trim().length >= 2,
    staleTime: 0,
  });
  const hits = useMemo(() => scannedSearch(query, notaRecords, crmRecords,
    (fiscalHistory.data ?? []).flatMap(run => run.corrected_rows.map(row => ({ ...row, importedAt: run.created_at }))), importDates),
    [query, notaRecords, crmRecords, fiscalHistory.data, importDates]);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem("nota.quickMessage");
      if (saved) setMessage(saved);
    } catch {}
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("nota.quickMessage", message);
    } catch {}
  }, [message, mounted]);

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Atalhos rápidos</h3>
        <p className="text-xs text-muted-foreground">
          Códigos fixos e mensagem padrão para copiar com um clique.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {FIXED_NUMBERS.map((n) => (
          <div
            key={n.value}
            className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{n.label}</div>
              <div className="font-mono text-sm font-medium truncate">{n.value}</div>
            </div>
            <CopyButton value={n.value} label={n.label} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Mensagem padrão</div>
        <div className="flex items-start gap-2">
          {editing ? (
            <Input
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditing(false);
              }}
              className="flex-1"
            />
          ) : (
            <div className="flex-1 rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground break-words">
              {message}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing((v) => !v)}
            aria-label={editing ? "Concluir edição" : "Editar mensagem"}
          >
            {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </Button>
          <CopyButton value={message} label="mensagem" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          Localizar já escaneados (nome ou CPF)
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite nome ou CPF..."
            className="pl-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {query.trim().length >= 2 && (
          <ImportDateFilter value={importDates} onChange={setImportDates} />
        )}
        {query.trim().length >= 2 && (
          <div className="rounded-md border bg-muted/20 max-h-80 overflow-y-auto divide-y">
            {fiscalHistory.isFetching && <p role="status" className="p-3 text-xs text-muted-foreground">Buscando apartamentos…</p>}
            {fiscalHistory.error && <p role="alert" className="p-3 text-xs text-destructive">Não foi possível consultar os apartamentos. Tente novamente.</p>}
            {hits.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                Nenhum registro encontrado.
              </div>
            ) : (
              hits.map((h) => (
                <div key={h.key} className="p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold break-words">{h.title}{h.apartments.length > 0 && ` ( UH ${h.apartments.join(", ")} )`}</div>
                      {h.importedAt && <div className="text-xs text-muted-foreground">Importado em {new Date(h.importedAt).toLocaleString("pt-BR")}</div>}
                      {h.subtitle && (
                        <div className="text-xs text-muted-foreground truncate">
                          {h.subtitle}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] uppercase tracking-wide bg-primary/10 text-primary rounded px-1.5 py-0.5">
                        {h.source}
                      </span>
                      <CopyButton
                        value={scannedCopyText(h)}
                        label={`${h.title} completo`}
                        text="Copiar tudo"
                      />
                    </div>
                  </div>
                  <div className="grid gap-1">
                    {h.apartments.map(apartment => <div key={apartment} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0"><span className="text-muted-foreground">Apartamento / UH:</span>{" "}<span className="font-medium break-words">{apartment}</span></div>
                      <CopyButton value={apartment} label="Apartamento / UH" />
                    </div>)}
                    {h.lines.map((l, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="text-muted-foreground">{l.label}:</span>{" "}
                          <span className="font-medium break-words">{l.value}</span>
                        </div>
                        <CopyButton value={l.value} label={l.label} />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildXlsx(records: NotaRecord[], emailsOnly: boolean): Promise<Blob> {
  const XLSX = await import("xlsx");
  let rows: Record<string, string>[];
  let headers: string[];
  if (emailsOnly) {
    headers = ["E-mail"];
    rows = records.map((r) => ({ "E-mail": r.email || "" }));
  } else {
    headers = ["Dt. Ult. Alteração", "Dt. Cadastro", "Nome", "CPF", "Telefone", "E-mail", "CEP", "Número"];
    rows = records.map((r) => ({
      "Dt. Ult. Alteração": r.dtAlteracao || "",
      "Dt. Cadastro": r.dtCadastro || "",
      Nome: r.nome || "",
      CPF: r.cpf || "",
      Telefone: r.telefone || "",
      "E-mail": r.email || "",
      CEP: r.cep || "",
      Número: r.numero || "",
    }));
  }
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  // Column widths (auto-fit)
  ws["!cols"] = headers.map((h) => {
    const max = Math.max(
      h.length,
      ...rows.map((r) => String((r as Record<string, string>)[h] ?? "").length),
    );
    return { wch: Math.min(Math.max(max + 2, 10), 50) };
  });
  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!views"] = [{ state: "frozen", ySplit: 1 }];
  // Auto filter on header row
  const lastCol = XLSX.utils.encode_col(headers.length - 1);
  ws["!autofilter"] = { ref: `A1:${lastCol}${rows.length + 1}` };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dados");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function buildPdf(records: NotaRecord[], emailsOnly: boolean): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: emailsOnly ? "p" : "l" });
  doc.setFillColor(20, 120, 150);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text("D4S · NOTA", 14, 14);
  doc.setFontSize(10);
  doc.text(
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    doc.internal.pageSize.getWidth() - 14,
    14,
    { align: "right" },
  );
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.text(`${records.length} registro(s)`, 14, 32);

  if (emailsOnly) {
    autoTable(doc, {
      head: [["E-mail"]],
      body: records.map((r) => [r.email || ""]),
      startY: 38,
      headStyles: { fillColor: [20, 120, 150] },
    });
  } else {
    autoTable(doc, {
      head: [["Dt. Ult. Alteração", "Dt. Cadastro", "Nome", "CPF", "Telefone", "E-mail", "CEP", "Número"]],
      body: records.map((r) => [
        r.dtAlteracao || "",
        r.dtCadastro || "",
        r.nome || "",
        r.cpf || "",
        r.telefone || "",
        r.email || "",
        r.cep || "",
        r.numero || "",
      ]),
      startY: 38,
      headStyles: { fillColor: [20, 120, 150] },
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
        didDrawPage: () => {
        const str = `Página ${doc.getNumberOfPages()}`;
        doc.setFontSize(8);
        doc.text(
          str,
          doc.internal.pageSize.getWidth() - 14,
          doc.internal.pageSize.getHeight() - 8,
          { align: "right" },
        );
      },
    });
  }
  return doc.output("blob");
}

async function buildDocx(records: NotaRecord[], emailsOnly: boolean): Promise<Blob> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "D4S · NOTA — Relatório", bold: true })],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Gerado em ${new Date().toLocaleString("pt-BR")}`, italics: true }),
      ],
    }),
    new Paragraph({ text: "" }),
  ];

  if (emailsOnly) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "E-mails", bold: true })],
      }),
    );
    records.forEach((r) => {
      if (r.email) children.push(new Paragraph({ text: r.email }));
    });
  } else {
    records.forEach((r, i) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: `Registro ${i + 1}`, bold: true })],
        }),
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Dt. Ult. Alteração: ", bold: true }),
            new TextRun({ text: r.dtAlteracao ? String(r.dtAlteracao) : "" }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Dt. Cadastro: ", bold: true }),
            new TextRun({ text: r.dtCadastro ? String(r.dtCadastro) : "" }),
          ],
        }),
      );
      FIELD_ORDER.forEach((k) => {
        const v = r[k];
        children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${FIELD_LABELS[k]}: `, bold: true }),
                new TextRun({ text: v ? String(v) : "" }),
              ],
            }),
          );
      });
      children.push(new Paragraph({ text: "" }));
    });
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

// ---------- Aba de E-mails com filtro por data ----------

function toLocalDateInput(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type EmailEntry = { id?: string; email: string; nome: string; date: Date; arquivo: string };

const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function EmailsTab({
  records,
  onSaveFile,
  onUpdateEmail,
}: {
  records: (NotaRecord & { _id?: string; _createdAt?: string })[];
  onSaveFile: (blob: Blob, name: string, kind: "pdf" | "xlsx", count: number) => Promise<void>;
  onUpdateEmail: (id: string, patch: { email: string | null }) => Promise<void>;
}) {
  const today = useMemo(() => toLocalDateInput(new Date()), []);
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState<string>("D4S · NOTA — E-mails");
  const [subtitle, setSubtitle] = useState<string>("");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const saveEdit = async () => {
    if (!editing) return;
    const v = editing.value.trim().toLowerCase();
    if (!isValidEmail(v)) {
      toast.error("E-mail inválido");
      return;
    }
    setSavingEdit(true);
    try {
      await onUpdateEmail(editing.id, { email: v || null });
      toast.success("E-mail atualizado");
      setEditing(null);
    } catch {
      toast.error("Falha ao atualizar e-mail");
    } finally {
      setSavingEdit(false);
    }
  };

  const entries = useMemo<EmailEntry[]>(() => {
    return records
      .filter((r) => r.email)
      .map((r) => ({
        id: r._id,
        email: r.email as string,
        nome: r.nome ?? "",
        arquivo: r._arquivo ?? "",
        date: r._createdAt ? new Date(r._createdAt) : new Date(0),
      }));
  }, [records]);

  const filtered = useMemo(() => {
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T23:59:59.999`) : null;
    return entries
      .filter((e) => (start ? e.date >= start : true) && (end ? e.date <= end : true))
      .filter((e) => !removed.has(e.email.toLowerCase()))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [entries, from, to, removed]);

  const copyAll = async () => {
    if (filtered.length === 0) return toast.error("Nenhum e-mail no período");
    await navigator.clipboard.writeText(filtered.map((e) => e.email).join("\n"));
    toast.success(`${filtered.length} e-mail(s) copiado(s)`);
  };

  const exportExcel = async () => {
    if (filtered.length === 0) return toast.error("Nenhum e-mail no período");
    setGenerating(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(
        filtered.map((e) => ({
          Data: e.date.getTime() > 0 ? e.date.toLocaleDateString("pt-BR") : "",
          Nome: e.nome || "",
          "E-mail": e.email,
        })),
      );
      ws["!cols"] = [{ wch: 12 }, { wch: 32 }, { wch: 36 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "E-mails");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const stamp = `${from || "inicio"}_a_${to || "hoje"}`;
      const safeTitle =
        (title || "emails")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40) || "emails";
      const name = nextVersionedName(`${safeTitle}_${stamp}`, "xlsx", []);
      downloadBlob(blob, name);
      await onSaveFile(blob, name, "xlsx", filtered.length);
      toast.success(`Excel gerado: ${name}`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar Excel");
    } finally {
      setGenerating(false);
    }
  };

  const exportPdf = async () => {
    if (filtered.length === 0) return toast.error("Nenhum e-mail no período");
    setGenerating(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const doc = new jsPDF({ orientation: "p" });
      doc.setFillColor(20, 120, 150);
      doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text(title || "D4S · NOTA — E-mails", 14, 14);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      const range =
        from && to
          ? `Período: ${new Date(`${from}T00:00:00`).toLocaleDateString("pt-BR")} até ${new Date(`${to}T00:00:00`).toLocaleDateString("pt-BR")}`
          : "Todos os períodos";
      let y = 30;
      if (subtitle.trim()) {
        doc.setFontSize(11);
        doc.text(subtitle.trim(), 14, y);
        y += 6;
        doc.setFontSize(10);
      }
      doc.text(range, 14, y);
      y += 6;
      doc.text(`${filtered.length} e-mail(s)`, 14, y);
      y += 4;
      autoTable(doc, {
        head: [["Data", "Nome", "E-mail"]],
        body: filtered.map((e) => [
          e.date.getTime() > 0 ? e.date.toLocaleDateString("pt-BR") : "—",
          e.nome || "—",
          e.email,
        ]),
        startY: y + 4,
        headStyles: { fillColor: [20, 120, 150] },
        styles: { fontSize: 9, cellPadding: 2, overflow: "linebreak" },
      });
      const blob = doc.output("blob");
      const stamp = `${from || "inicio"}_a_${to || "hoje"}`;
      const safeTitle = (title || "emails")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "emails";
      const name = nextVersionedName(`${safeTitle}_${stamp}`, "pdf", []);
      downloadBlob(blob, name);
      await onSaveFile(blob, name, "pdf", filtered.length);
      toast.success(`PDF gerado: ${name}`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar PDF");
    } finally {
      setGenerating(false);
    }
  };

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setFrom(toLocalDateInput(start));
    setTo(toLocalDateInput(end));
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Filtrar por data</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label htmlFor="from" className="text-xs text-muted-foreground">De</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs text-muted-foreground">Até</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
              Limpar
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setFrom(today); setTo(today); }}>
            Hoje
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreset(7)}>Últimos 7 dias</Button>
          <Button variant="outline" size="sm" onClick={() => setPreset(30)}>Últimos 30 dias</Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Cabeçalho do PDF</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pdf-title" className="text-xs text-muted-foreground">Título</Label>
            <Input
              id="pdf-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Lista de e-mails — Junho 2026"
            />
          </div>
          <div>
            <Label htmlFor="pdf-sub" className="text-xs text-muted-foreground">
              Subtítulo (opcional)
            </Label>
            <Input
              id="pdf-sub"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Ex.: Campanha CRM"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          O título aparece no topo do PDF e também é usado no nome do arquivo.
        </p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {filtered.length} e-mail(s) no período
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copyAll} disabled={filtered.length === 0}>
            <Copy className="w-4 h-4 mr-2" /> Copiar todos
          </Button>
          {removed.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setRemoved(new Set())}>
              Restaurar removidos ({removed.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={filtered.length === 0 || generating}
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
          </Button>
          <Button size="sm" onClick={exportPdf} disabled={filtered.length === 0 || generating}>
            {generating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            Exportar PDF
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-50" />
          Nenhum e-mail encontrado no período selecionado.
        </Card>
      ) : (
        <Card className="divide-y">
          {filtered.map((e, i) => (
            <div key={i} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {editing && editing.id === e.id ? (
                  <div className="space-y-1">
                    <Input
                      autoFocus
                      type="email"
                      value={editing.value}
                      placeholder="email@exemplo.com"
                      className={
                        !isValidEmail(editing.value)
                          ? "border-destructive focus-visible:ring-destructive"
                          : undefined
                      }
                      onChange={(ev) => setEditing({ id: e.id!, value: ev.target.value })}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") saveEdit();
                        if (ev.key === "Escape") setEditing(null);
                      }}
                    />
                    {!isValidEmail(editing.value) && (
                      <div className="text-xs text-destructive">E-mail inválido</div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm font-medium truncate">{e.email}</div>
                )}
                <div className="text-xs text-muted-foreground truncate">
                  {e.nome || "Sem nome"} ·{" "}
                  {e.date.getTime() > 0 ? e.date.toLocaleString("pt-BR") : "—"}
                </div>
              </div>
              {editing && editing.id === e.id ? (
                <>
                  <Button
                    size="sm"
                    disabled={savingEdit || !isValidEmail(editing.value)}
                    onClick={saveEdit}
                  >
                    {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={savingEdit} onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  {e.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar e-mail"
                      onClick={() => setEditing({ id: e.id!, value: e.email })}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  <CopyButton value={e.email} label="e-mail" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover e-mail da lista"
                    onClick={() =>
                      setRemoved((prev) => new Set(prev).add(e.email.toLowerCase()))
                    }
                  >
                    <X className="w-4 h-4 text-destructive" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ---------- Aba de Números (telefones) com filtro por data ----------

type PhoneEntry = { id?: string; telefone: string; nome: string; date: Date; arquivo: string };

function PhonesTab({
  records,
  onSaveFile,
  onUpdatePhone,
}: {
  records: (NotaRecord & { _id?: string; _createdAt?: string })[];
  onSaveFile: (blob: Blob, name: string, kind: "pdf" | "xlsx", count: number) => Promise<void>;
  onUpdatePhone: (id: string, patch: { telefone: string | null }) => Promise<void>;
}) {
  const today = useMemo(() => toLocalDateInput(new Date()), []);
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState<string>("D4S · NOTA — Números");
  const [subtitle, setSubtitle] = useState<string>("");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const saveEdit = async () => {
    if (!editing) return;
    const v = editing.value.trim();
    if (!isValidPhone(v)) {
      toast.error("Formato inválido — use DDD + número, ex: (11) 91234-5678");
      return;
    }
    setSavingEdit(true);
    try {
      await onUpdatePhone(editing.id, { telefone: v ? formatPhone(v) : null });
      toast.success("Telefone atualizado");
      setEditing(null);
    } catch {
      toast.error("Falha ao atualizar telefone");
    } finally {
      setSavingEdit(false);
    }
  };

  const [fixing, setFixing] = useState<{ done: number; total: number } | null>(null);

  /** Reprocessa TODOS os telefones já salvos: remove +55, zeros e aplica a máscara. */
  const fixAllPhones = async () => {
    const pending = records
      .filter((r) => r._id && String(r.telefone ?? "").trim())
      .map((r) => {
        const cur = String(r.telefone).trim();
        const fixed = formatPhone(cur);
        return { id: r._id as string, cur, next: isValidPhone(fixed) ? fixed : null };
      })
      .filter((p) => (p.next ?? "") !== p.cur);
    if (pending.length === 0) {
      toast.success("Todos os números já estão no formato correto");
      return;
    }
    setFixing({ done: 0, total: pending.length });
    let ok = 0;
    for (const p of pending) {
      try {
        await onUpdatePhone(p.id, { telefone: p.next });
        ok++;
      } catch {
        /* ignora e segue */
      }
      setFixing({ done: ok, total: pending.length });
    }
    setFixing(null);
    toast.success(`${ok} número(s) corrigido(s)`);
  };


  const entries = useMemo<PhoneEntry[]>(() => {
    return records
      .filter((r) => r.telefone)
      .map((r) => ({
        id: r._id,
        telefone: r.telefone as string,
        nome: r.nome ?? "",
        arquivo: r._arquivo ?? "",
        date: r._createdAt ? new Date(r._createdAt) : new Date(0),
      }));
  }, [records]);


  const filtered = useMemo(() => {
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T23:59:59.999`) : null;
    return entries
      .filter((e) => (start ? e.date >= start : true) && (end ? e.date <= end : true))
      .filter((e) => !removed.has(e.telefone.replace(/\D+/g, "")))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [entries, from, to, removed]);

  const copyAll = async () => {
    if (filtered.length === 0) return toast.error("Nenhum número no período");
    await navigator.clipboard.writeText(filtered.map((e) => e.telefone).join("\n"));
    toast.success(`${filtered.length} número(s) copiado(s)`);
  };

  const exportExcel = async () => {
    if (filtered.length === 0) return toast.error("Nenhum número no período");
    setGenerating(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(
        filtered.map((e) => ({
          Data: e.date.getTime() > 0 ? e.date.toLocaleDateString("pt-BR") : "",
          Nome: e.nome || "",
          Telefone: e.telefone,
        })),
      );
      ws["!cols"] = [{ wch: 12 }, { wch: 32 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Números");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const stamp = `${from || "inicio"}_a_${to || "hoje"}`;
      const safeTitle =
        (title || "numeros")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40) || "numeros";
      const name = nextVersionedName(`${safeTitle}_${stamp}`, "xlsx", []);
      downloadBlob(blob, name);
      await onSaveFile(blob, name, "xlsx", filtered.length);
      toast.success(`Excel gerado: ${name}`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar Excel");
    } finally {
      setGenerating(false);
    }
  };

  const exportPdf = async () => {
    if (filtered.length === 0) return toast.error("Nenhum número no período");
    setGenerating(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const doc = new jsPDF({ orientation: "p" });
      doc.setFillColor(20, 120, 150);
      doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text(title || "D4S · NOTA — Números", 14, 14);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      const range =
        from && to
          ? `Período: ${new Date(`${from}T00:00:00`).toLocaleDateString("pt-BR")} até ${new Date(`${to}T00:00:00`).toLocaleDateString("pt-BR")}`
          : "Todos os períodos";
      let y = 30;
      if (subtitle.trim()) {
        doc.setFontSize(11);
        doc.text(subtitle.trim(), 14, y);
        y += 6;
        doc.setFontSize(10);
      }
      doc.text(range, 14, y);
      y += 6;
      doc.text(`${filtered.length} número(s)`, 14, y);
      autoTable(doc, {
        head: [["Data", "Nome", "Telefone"]],
        body: filtered.map((e) => [
          e.date.getTime() > 0 ? e.date.toLocaleDateString("pt-BR") : "—",
          e.nome || "—",
          e.telefone,
        ]),
        startY: y + 4,
        headStyles: { fillColor: [20, 120, 150] },
        styles: { fontSize: 9, cellPadding: 2, overflow: "linebreak" },
      });
      const blob = doc.output("blob");
      const stamp = `${from || "inicio"}_a_${to || "hoje"}`;
      const safeTitle = (title || "numeros")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "numeros";
      const name = nextVersionedName(`${safeTitle}_${stamp}`, "pdf", []);
      downloadBlob(blob, name);
      await onSaveFile(blob, name, "pdf", filtered.length);
      toast.success(`PDF gerado: ${name}`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar PDF");
    } finally {
      setGenerating(false);
    }
  };

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setFrom(toLocalDateInput(start));
    setTo(toLocalDateInput(end));
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Filtrar por data</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label htmlFor="p-from" className="text-xs text-muted-foreground">De</Label>
            <Input id="p-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="p-to" className="text-xs text-muted-foreground">Até</Label>
            <Input id="p-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
              Limpar
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setFrom(today); setTo(today); }}>
            Hoje
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreset(7)}>Últimos 7 dias</Button>
          <Button variant="outline" size="sm" onClick={() => setPreset(30)}>Últimos 30 dias</Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Cabeçalho do PDF</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="p-title" className="text-xs text-muted-foreground">Título</Label>
            <Input
              id="p-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Lista de números — Junho 2026"
            />
          </div>
          <div>
            <Label htmlFor="p-sub" className="text-xs text-muted-foreground">
              Subtítulo (opcional)
            </Label>
            <Input
              id="p-sub"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Ex.: Campanha WhatsApp"
            />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {filtered.length} número(s) no período
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fixAllPhones}
            disabled={!!fixing || records.length === 0}
            title="Reprocessa todos os números já salvos"
          >
            {fixing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Phone className="w-4 h-4 mr-2" />
            )}
            {fixing ? `Corrigindo ${fixing.done}/${fixing.total}` : "Corrigir todos os números"}
          </Button>
          <Button variant="outline" size="sm" onClick={copyAll} disabled={filtered.length === 0}>
            <Copy className="w-4 h-4 mr-2" /> Copiar todos
          </Button>

          {removed.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setRemoved(new Set())}>
              Restaurar removidos ({removed.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={filtered.length === 0 || generating}
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
          </Button>
          <Button size="sm" onClick={exportPdf} disabled={filtered.length === 0 || generating}>
            {generating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            Exportar PDF
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Phone className="w-10 h-10 mx-auto mb-3 opacity-50" />
          Nenhum número encontrado no período selecionado.
        </Card>
      ) : (
        <Card className="divide-y">
          {filtered.map((e, i) => (
            <div key={i} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {editing && editing.id === e.id ? (
                  <div className="space-y-1">
                    <Input
                      autoFocus
                      value={editing.value}
                      inputMode="tel"
                      placeholder="(00) 00000-0000"
                      className={
                        !isValidPhone(editing.value)
                          ? "border-destructive focus-visible:ring-destructive"
                          : undefined
                      }
                      onChange={(ev) =>
                        setEditing({ id: e.id!, value: maskPhoneInput(ev.target.value) })
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") saveEdit();
                        if (ev.key === "Escape") setEditing(null);
                      }}
                    />
                    {!isValidPhone(editing.value) && (
                      <div className="text-xs text-destructive">
                        Formato inválido — use DDD + número
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm font-medium truncate">{e.telefone}</div>
                )}
                <div className="text-xs text-muted-foreground truncate">
                  {e.nome || "Sem nome"} ·{" "}
                  {e.date.getTime() > 0 ? e.date.toLocaleString("pt-BR") : "—"}
                </div>
              </div>
              {editing && editing.id === e.id ? (
                <>
                  <Button
                    size="sm"
                    disabled={savingEdit || !isValidPhone(editing.value)}
                    onClick={saveEdit}
                  >
                    {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={savingEdit} onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  {e.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar telefone"
                      onClick={() => setEditing({ id: e.id!, value: maskPhoneInput(e.telefone) })}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  <CopyButton value={e.telefone} label="telefone" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover número da lista"
                    onClick={() =>
                      setRemoved((prev) => new Set(prev).add(e.telefone.replace(/\D+/g, "")))
                    }
                  >
                    <X className="w-4 h-4 text-destructive" />
                  </Button>
                </>
              )}
            </div>
          ))}

        </Card>
      )}
    </div>
  );
}

// ---------- Aba CRM (isolada) ----------

const CRM_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.csv";
const CRM_ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const CRM_SHEET_EXT = /\.(xlsx|xls|csv)$/i;
const isSheetFile = (f: File) => CRM_SHEET_EXT.test(f.name);

// Categorias de campos que o usuário pode marcar/desmarcar para exibir e exportar
const CRM_CATEGORIES: { key: string; label: string; match: (r: string) => boolean }[] = [
  { key: "nome", label: "Nome", match: (r) => /(nome|razão social|razao social)/i.test(r) },
  { key: "cpf", label: "CPF", match: (r) => /\bcpf\b/i.test(r) },
  { key: "email", label: "Email", match: (r) => /(e-?mail)/i.test(r) },
  { key: "telefone", label: "Telefone", match: (r) => /(telefone|celular|fone|whats)/i.test(r) },
  { key: "endereco", label: "Endereço", match: (r) => /(endere[cç]o|logradouro|rua|avenida|bairro|cidade|estado|cep|n[uú]mero)/i.test(r) },
  { key: "profissao", label: "Profissão", match: (r) => /(profiss[aã]o|cargo|ocupa[cç][aã]o|fun[cç][aã]o)/i.test(r) },
];

function filterCampos<T extends { rotulo: string }>(campos: T[], selected: Record<string, boolean>): T[] {
  const active = CRM_CATEGORIES.filter((c) => selected[c.key]);
  // Se nada marcado, mostra tudo (evita tela vazia)
  if (active.length === 0) return campos;
  return campos.filter((c) => active.some((cat) => cat.match(c.rotulo)));
}

function CrmTab() {
  const { records, total, loading, syncing, addOne, upsertOne, removeOne, clearAll } = useCrmRecords();
  const extract = useServerFn(extractFullFromFile);
  const [processing, setProcessing] = useState(false);
  const [current, setCurrent] = useState<string>("");
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueDone, setQueueDone] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CRM_CATEGORIES.map((c) => [c.key, true])),
  );
  const toggleCat = (key: string) =>
    setSelected((s) => ({ ...s, [key]: !s[key] }));

  const scanFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) => CRM_ACCEPTED.includes(f.type) || isSheetFile(f));
    if (arr.length === 0) {
      toast.error("Nenhum arquivo válido");
      return;
    }
    setProcessing(true);
    setQueueTotal(arr.length);
    setQueueDone(0);
    // Individual: um arquivo por vez, cada um vira um registro próprio
    for (const f of arr) {
      setCurrent(f.name);
      try {
        if (isSheetFile(f)) {
          const XLSX = await import("xlsx");
          const buf = await f.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          let added = 0;
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
              defval: "",
              raw: false,
            });
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              const campos = Object.entries(row)
                .map(([rotulo, valor]) => ({
                  rotulo: String(rotulo).trim(),
                  valor: String(valor ?? "").trim(),
                }))
                .filter((c) => c.rotulo && c.valor);
              if (campos.length === 0) continue;
              await addOne({
                arquivo: `${f.name} — ${sheetName} · linha ${i + 2}`,
                documento_tipo: "Planilha",
                campos,
              });
              added++;
            }
          }
          if (added === 0) toast.error(`Nenhuma linha em ${f.name}`);
          else toast.success(`✓ ${f.name} (${added} linha(s))`);
          continue;
        }
        const base64 = await fileToBase64(f);
        const res = await extract({
          data: { file: { name: f.name, mimeType: f.type, dataBase64: base64 } },
        });
        const result = await upsertOne({
          arquivo: res.extraction.arquivo,
          documento_tipo: res.extraction.documento_tipo ?? null,
          campos: res.extraction.campos ?? [],
        });
        if (result.merged) {
          toast.success(
            result.added > 0
              ? `↺ ${f.name} — ${result.added} novo(s) campo(s) adicionado(s)`
              : `↺ ${f.name} — já escaneado, nada novo`,
          );
        } else {
          toast.success(`✓ ${f.name}`);
        }
      } catch (e) {
        console.error("[CRM]", e);
        toast.error(`Falha em ${f.name}`);
      } finally {
        setQueueDone((n) => n + 1);
      }
    }
    setProcessing(false);
    setCurrent("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const exportPdf = async () => {
    if (records.length === 0) return toast.error("Nenhum registro no CRM");
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "p" });
    doc.setFillColor(20, 120, 150);
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("D4S · NOTA — CRM", 14, 14);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`${records.length} registro(s)`, 14, 30);
    records.forEach((r, idx) => {
      if (idx > 0) doc.addPage();
      doc.setFontSize(12);
      doc.text(`${idx + 1}. ${r.arquivo || "Sem nome"}`, 14, 44);
      if (r.documento_tipo) {
        doc.setFontSize(10);
        doc.text(`Tipo: ${r.documento_tipo}`, 14, 50);
      }
      autoTable(doc, {
        head: [["Campo", "Valor"]],
        body: filterCampos(r.campos, selected).map((c) => [c.rotulo, c.valor]),
        startY: 56,
        headStyles: { fillColor: [20, 120, 150] },
        styles: { fontSize: 9, cellPadding: 2, overflow: "linebreak" },
      });
    });
    downloadBlob(doc.output("blob"), `crm_${Date.now()}.pdf`);
    toast.success("PDF do CRM gerado");
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 border-primary/30 bg-primary/5 space-y-2">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Módulo CRM — extração completa e individual</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Escaneie um arquivo por vez. Todas as informações visíveis são extraídas
          e salvas de forma <strong>separada</strong> das demais abas — nada se mistura.
        </p>
      </Card>

      <Card
        className="p-8 border-dashed border-2 hover:border-primary/50 transition-colors cursor-pointer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && !processing) scanFiles(e.dataTransfer.files);
        }}
        onClick={() => !processing && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={CRM_ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files && scanFiles(e.target.files)}
        />
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-primary/10 mx-auto flex items-center justify-center">
            <ScanLine className="w-7 h-7 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">
              {processing
                ? `Escaneando ${queueDone + 1}/${queueTotal}: ${current}`
                : "Arraste ou clique para escanear arquivos individualmente"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              JPG, PNG, WEBP, PDF — cada arquivo gera um registro. XLSX, XLS, CSV — cada linha vira um registro.
            </p>
          </div>
          {processing && (
            <Progress value={(queueDone / Math.max(1, queueTotal)) * 100} />
          )}
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <p className="text-sm font-medium">Marque os campos que deseja exibir e exportar:</p>
        <div className="flex flex-wrap gap-3">
          {CRM_CATEGORIES.map((cat) => (
            <label
              key={cat.key}
              className="flex items-center gap-2 text-sm cursor-pointer select-none px-2 py-1 rounded-md border hover:bg-accent"
            >
              <Checkbox
                checked={!!selected[cat.key]}
                onCheckedChange={() => toggleCat(cat.key)}
              />
              {cat.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Se nada estiver marcado, todos os campos aparecem.
        </p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {loading ? "Carregando..." : `${total} registro(s) no CRM`}
          {syncing && (
            <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin text-muted-foreground" />
          )}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={records.length === 0}>
            <FileText className="w-4 h-4 mr-2" /> Exportar PDF
          </Button>
          {records.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Remover TODOS os registros do CRM?")) {
                  clearAll().then(() => toast.success("CRM limpo"));
                }
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Limpar
            </Button>
          )}
        </div>
      </div>

      {records.length === 0 && !loading ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
          Nenhum registro no CRM ainda. Escaneie um arquivo acima.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {records.map((r) => (
            <CrmCard
              key={r.id}
              record={r}
              onDelete={() => removeOne(r.id)}
              selected={selected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CrmCard({
  record,
  onDelete,
  selected,
}: {
  record: CrmRecord;
  onDelete: () => void;
  selected: Record<string, boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const visibleCampos = filterCampos(record.campos, selected);
  const copyAll = async () => {
    const text = [
      record.documento_tipo ? `Tipo: ${record.documento_tipo}` : null,
      ...visibleCampos.map((c) => `${c.rotulo}: ${c.valor}`),
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("Copiado");
  };
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-2 pb-2 border-b">
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{record.arquivo || "Sem nome"}</div>
          <div className="text-xs text-muted-foreground">
            {record.documento_tipo || "Documento"} ·{" "}
            {new Date(record.created_at).toLocaleString("pt-BR")}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={copyAll}>
          {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Remover">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="space-y-2 max-h-80 overflow-auto pr-1">
        {visibleCampos.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhum campo extraído.</p>
        ) : (
          visibleCampos.map((c, i) => (
            <FieldRow key={i} label={c.rotulo} value={c.valor || "—"} />
          ))
        )}
      </div>
    </Card>
  );
}
