import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractFromFiles, type NotaRecord } from "@/lib/nota.functions";

export const Route = createFileRoute("/")({
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
    ],
  }),
  component: NotaTool,
});

const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.pdf";
const MAX_FILES = 10;

const FIELD_LABELS: Record<keyof Omit<NotaRecord, "_arquivo">, string> = {
  nome: "Nome",
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  cep: "CEP",
  endereco: "Endereço",
  numero: "Número",
  bairro: "Bairro",
  cidade: "Cidade",
  estado: "Estado",
  notaFiscal: "Número da Nota Fiscal",
  data: "Data da Nota",
  valor: "Valor Total",
};

type ExportKind = "docx" | "xlsx" | "pdf";
type HistoryItem = { id: string; name: string; kind: ExportKind; date: string; count: number };

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

function loadHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("nota.history") || "[]");
  } catch {
    return [];
  }
}
function saveHistory(items: HistoryItem[]) {
  localStorage.setItem("nota.history", JSON.stringify(items));
}

function nextVersionedName(base: string, ext: ExportKind, history: HistoryItem[]) {
  const prefix = `${base}_`;
  const used = history
    .filter((h) => h.kind === ext && h.name.startsWith(prefix))
    .map((h) => {
      const m = h.name.match(/_(\d{3})\./);
      return m ? parseInt(m[1]!, 10) : 0;
    });
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${base}_${String(next).padStart(3, "0")}.${ext}`;
}

function NotaTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [records, setRecords] = useState<NotaRecord[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const [exportDialog, setExportDialog] = useState<{
    kind: ExportKind;
    emailsOnly: boolean;
  } | null>(null);
  const [exportMode, setExportMode] = useState<"new" | "append">("new");
  const inputRef = useRef<HTMLInputElement>(null);
  const extract = useServerFn(extractFromFiles);

  useEffect(() => {
    setMounted(true);
    setHistory(loadHistory());
    try {
      const saved = localStorage.getItem("nota.records");
      if (saved) setRecords(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("nota.records", JSON.stringify(records));
    } catch {}
  }, [records, mounted]);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const valid = arr.filter((f) => ACCEPTED.includes(f.type));
    const rejected = arr.length - valid.length;
    if (rejected > 0) toast.error(`${rejected} arquivo(s) com formato não suportado`);
    setFiles((prev) => {
      const merged = [...prev, ...valid].slice(0, MAX_FILES);
      if (prev.length + valid.length > MAX_FILES)
        toast.warning(`Máximo de ${MAX_FILES} arquivos por vez`);
      return merged;
    });
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
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          mimeType: f.type,
          dataBase64: await fileToBase64(f),
        })),
      );
      const res = await extract({ data: { files: payload } });
      console.log("[NOTA] SAVED_DATA", res.records);
      setRecords(res.records);
      setProgress(100);
      toast.success(`${res.records.length} documento(s) processado(s)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao processar";
      toast.error(msg);
    } finally {
      clearInterval(tick);
      setProcessing(false);
      setTimeout(() => setProgress(0), 1200);
    }
  };

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
    const name = nextVersionedName(base, kind, history);
    try {
      const data = emailsOnly
        ? allEmails.map((e) => ({ _arquivo: "", email: e }) as NotaRecord)
        : records;
      console.log(`[NOTA] EXPORT_${kind.toUpperCase()}_DATA`, data);
      if (kind === "xlsx") await exportXlsx(name, data, emailsOnly);
      else if (kind === "pdf") await exportPdf(name, data, emailsOnly);
      else await exportDocx(name, data, emailsOnly);
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        name,
        kind,
        date: new Date().toISOString(),
        count: data.length,
      };
      const next = [item, ...history].slice(0, 50);
      setHistory(next);
      saveHistory(next);
      toast.success(`Arquivo gerado: ${name}`);
      setExportDialog(null);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar arquivo");
    }
  };

  const reExport = async (h: HistoryItem) => {
    // Re-gera arquivo com os mesmos dados atuais (best-effort, sem persistir blobs)
    if (records.length === 0) {
      toast.error("Processe documentos novamente para baixar uma nova versão");
      return;
    }
    const data = records;
    if (h.kind === "xlsx") await exportXlsx(h.name, data, false);
    else if (h.kind === "pdf") await exportPdf(h.name, data, false);
    else await exportDocx(h.name, data, false);
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
          <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary font-medium hidden sm:inline">
            Plano Empresarial
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Tabs defaultValue="processar" className="space-y-6">
          <TabsList>
            <TabsTrigger value="processar">
              <FileText className="w-4 h-4 mr-2" />
              Processar
            </TabsTrigger>
            <TabsTrigger value="historico">
              <History className="w-4 h-4 mr-2" />
              Arquivos Gerados{mounted ? ` (${history.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="processar" className="space-y-6">
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
                    Até 10 arquivos · JPG, JPEG, PNG, WEBP, PDF
                  </p>
                </div>
              </div>
            </Card>

            {files.length > 0 && (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {files.length} arquivo(s) selecionado(s)
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles([])}
                    disabled={processing}
                  >
                    Limpar
                  </Button>
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

                <div className="grid gap-4 md:grid-cols-2">
                  {records.map((r, idx) => (
                    <RecordCard key={idx} record={r} />
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="historico">
            {history.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <History className="w-10 h-10 mx-auto mb-3 opacity-50" />
                Nenhum arquivo gerado ainda.
              </Card>
            ) : (
              <Card className="divide-y">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{h.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(h.date).toLocaleString("pt-BR")} · {h.count} registro(s)
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => reExport(h)}>
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = history.filter((x) => x.id !== h.id);
                          setHistory(next);
                          saveHistory(next);
                        }}
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

function RecordCard({ record }: { record: NotaRecord }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const entries = (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[])
    .map((k) => [k, record[k]] as const)
    .filter(([, v]) => v != null && v !== "");

  const copyAll = async () => {
    const text = entries.map(([k, v]) => `${FIELD_LABELS[k]}: ${v}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
    toast.success("Copiado");
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <span className="text-xs text-muted-foreground truncate">{record._arquivo}</span>
        <Button size="sm" variant="outline" onClick={copyAll}>
          {copiedAll ? (
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
          ) : (
            <Copy className="w-3.5 h-3.5 mr-1.5" />
          )}
          Copiar tudo
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Nenhum dado pôde ser extraído deste documento.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(([k, v]) => (
            <FieldRow key={k} label={FIELD_LABELS[k]} value={String(v)} />
          ))}
        </div>
      )}
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

async function exportXlsx(name: string, records: NotaRecord[], emailsOnly: boolean) {
  const XLSX = await import("xlsx");
  let rows: Record<string, string>[];
  let headers: string[];
  if (emailsOnly) {
    headers = ["E-mail"];
    rows = records.map((r) => ({ "E-mail": r.email || "" }));
  } else {
    headers = [
      "Nome",
      "CPF",
      "CNPJ",
      "E-mail",
      "Telefone",
      "CEP",
      "Endereço",
      "Número",
      "Bairro",
      "Cidade",
      "Estado",
      "Nota Fiscal",
      "Data",
      "Valor",
    ];
    rows = records.map((r) => ({
      Nome: r.nome || "",
      CPF: r.cpf || "",
      CNPJ: r.cnpj || "",
      "E-mail": r.email || "",
      Telefone: r.telefone || "",
      CEP: r.cep || "",
      Endereço: r.endereco || "",
      Número: r.numero || "",
      Bairro: r.bairro || "",
      Cidade: r.cidade || "",
      Estado: r.estado || "",
      "Nota Fiscal": r.notaFiscal || "",
      Data: r.data || "",
      Valor: r.valor || "",
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
  downloadBlob(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    name,
  );
}

async function exportPdf(name: string, records: NotaRecord[], emailsOnly: boolean) {
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
      head: [[
        "Nome",
        "CPF/CNPJ",
        "E-mail",
        "Telefone",
        "Endereço",
        "Cidade/UF",
        "Nota",
        "Data",
        "Valor",
      ]],
      body: records.map((r) => [
        r.nome || "",
        r.cpf || r.cnpj || "",
        r.email || "",
        r.telefone || "",
        [r.endereco, r.numero, r.bairro].filter(Boolean).join(", "),
        [r.cidade, r.estado].filter(Boolean).join("/"),
        r.notaFiscal || "",
        r.data || "",
        r.valor || "",
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
  downloadBlob(doc.output("blob"), name);
}

async function exportDocx(name: string, records: NotaRecord[], emailsOnly: boolean) {
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
      (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).forEach((k) => {
        const v = r[k];
        if (v) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${FIELD_LABELS[k]}: `, bold: true }),
                new TextRun({ text: String(v) }),
              ],
            }),
          );
        }
      });
      children.push(new Paragraph({ text: "" }));
    });
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, name);
}
