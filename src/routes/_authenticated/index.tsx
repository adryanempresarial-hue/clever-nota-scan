import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { useCloudRecords, useCloudFiles, signOut, type CloudFile } from "@/lib/nota-sync";
import { extractFullFromFile } from "@/lib/crm.functions";
import { useCrmRecords, type CrmRecord } from "@/lib/crm-sync";

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
    ],
  }),
  component: NotaTool,
});

const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.csv,.ods";
const SHEET_EXT = /\.(xlsx|xls|xlsm|csv|ods)$/i;
const isSheet = (f: File) => SHEET_EXT.test(f.name);
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

function NotaTool() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [autoProcess, setAutoProcess] = useState(true);
  const pendingAutoRef = useRef(false);
  const {
    records,
    loading: loadingRecords,
    syncing: syncingRecords,
    addMany,
    removeOne,
    clearAll,
  } = useCloudRecords();
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
  const extract = useServerFn(extractFromFiles);

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
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          mimeType: f.type,
          dataBase64: await fileToBase64(f),
        })),
      );
      const res = await extract({ data: { files: payload } });
      console.log("[NOTA] SAVED_DATA", res.records);
      await addMany(res.records);
      setProgress(100);
      toast.success(`${res.records.length} documento(s) processado(s)`);
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
    navigate({ to: "/auth" });
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

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Tabs defaultValue="processar" className="space-y-6">
          <TabsList>
            <TabsTrigger value="processar">
              <FileText className="w-4 h-4 mr-2" />
              Processar
            </TabsTrigger>
            <TabsTrigger value="salvos">
              <FileImage className="w-4 h-4 mr-2" />
              Salvos{loadingCloud ? "" : ` (${records.length})`}
            </TabsTrigger>
            <TabsTrigger value="emails">
              <Mail className="w-4 h-4 mr-2" />
              E-mails
            </TabsTrigger>
            <TabsTrigger value="numeros">
              <Phone className="w-4 h-4 mr-2" />
              Números
            </TabsTrigger>
            <TabsTrigger value="crm">
              <Users className="w-4 h-4 mr-2" />
              CRM
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
                <div className="grid gap-4 md:grid-cols-2">
                  {records.map((r) => (
                    <RecordCard
                      key={r._id ?? r._arquivo}
                      record={r}
                      onDelete={() => removeOne(r._id)}
                    />
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="emails">
            <EmailsTab records={records} onSaveFile={saveFile} />
          </TabsContent>

          <TabsContent value="numeros">
            <PhonesTab records={records} onSaveFile={saveFile} />
          </TabsContent>

          <TabsContent value="crm">
            <CrmTab />
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
    const text = entries
      .map(([k, v]) => `${FIELD_LABELS[k]}: ${v ?? ""}`)
      .join("\n");
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
            <div className="font-semibold text-foreground truncate">{record.nome}</div>
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

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
        toast.success("Copiado");
      }}
      aria-label={`Copiar ${label ?? "valor"}`}
    >
      {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
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

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const digits = (s: string) => s.replace(/\D+/g, "");

  type SearchHit = {
    key: string;
    source: "Nota" | "CRM";
    title: string;
    subtitle: string;
    lines: { label: string; value: string }[];
  };

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    const qn = normalize(q);
    const qd = digits(q);
    const results: SearchHit[] = [];
    for (const r of notaRecords) {
      const nome = r.nome || "";
      const cpf = r.cpf || "";
      const matchName = nome && normalize(nome).includes(qn);
      const matchCpf = qd.length >= 3 && cpf && digits(cpf).includes(qd);
      if (!matchName && !matchCpf) continue;
      results.push({
        key: `nota-${r._id ?? nome + cpf}`,
        source: "Nota",
        title: nome || "(sem nome)",
        subtitle: r._arquivo || "",
        lines: [
          { label: "Nome", value: nome },
          { label: "CPF", value: cpf },
          { label: "Telefone", value: r.telefone || "" },
          { label: "E-mail", value: r.email || "" },
          { label: "CEP", value: r.cep || "" },
          { label: "Número", value: r.numero || "" },
        ].filter((l) => l.value),
      });
    }
    for (const r of crmRecords) {
      const nomeField = r.campos.find((c) => /nome|raz[aã]o/i.test(c.rotulo));
      const cpfField = r.campos.find((c) => /cpf|cnpj/i.test(c.rotulo));
      const nome = nomeField?.valor ?? "";
      const cpf = cpfField?.valor ?? "";
      const matchName = nome && normalize(nome).includes(qn);
      const matchCpf = qd.length >= 3 && cpf && digits(cpf).includes(qd);
      if (!matchName && !matchCpf) continue;
      results.push({
        key: `crm-${r.id}`,
        source: "CRM",
        title: nome || "(sem nome)",
        subtitle: r.arquivo || "",
        lines: r.campos
          .filter((c) => c.valor)
          .slice(0, 8)
          .map((c) => ({ label: c.rotulo, value: c.valor })),
      });
    }
    return results.slice(0, 20);
  }, [query, notaRecords, crmRecords]);

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
          <div className="rounded-md border bg-muted/20 max-h-80 overflow-auto divide-y">
            {hits.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                Nenhum registro encontrado.
              </div>
            ) : (
              hits.map((h) => (
                <div key={h.key} className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{h.title}</div>
                      {h.subtitle && (
                        <div className="text-xs text-muted-foreground truncate">
                          {h.subtitle}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wide bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">
                      {h.source}
                    </span>
                  </div>
                  <div className="grid gap-1">
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
    headers = ["Nome", "CPF", "Telefone", "E-mail", "CEP", "Número"];
    rows = records.map((r) => ({
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
      head: [["Nome", "CPF", "Telefone", "E-mail", "CEP", "Número"]],
      body: records.map((r) => [
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

type EmailEntry = { email: string; nome: string; date: Date; arquivo: string };

function EmailsTab({
  records,
  onSaveFile,
}: {
  records: (NotaRecord & { _id?: string; _createdAt?: string })[];
  onSaveFile: (blob: Blob, name: string, kind: "pdf", count: number) => Promise<void>;
}) {
  const today = useMemo(() => toLocalDateInput(new Date()), []);
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState<string>("D4S · NOTA — E-mails");
  const [subtitle, setSubtitle] = useState<string>("");

  const entries = useMemo<EmailEntry[]>(() => {
    return records
      .filter((r) => r.email)
      .map((r) => ({
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
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [entries, from, to]);

  const copyAll = async () => {
    if (filtered.length === 0) return toast.error("Nenhum e-mail no período");
    await navigator.clipboard.writeText(filtered.map((e) => e.email).join("\n"));
    toast.success(`${filtered.length} e-mail(s) copiado(s)`);
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
                <div className="text-sm font-medium truncate">{e.email}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {e.nome || "Sem nome"} ·{" "}
                  {e.date.getTime() > 0 ? e.date.toLocaleString("pt-BR") : "—"}
                </div>
              </div>
              <CopyButton value={e.email} label="e-mail" />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ---------- Aba de Números (telefones) com filtro por data ----------

type PhoneEntry = { telefone: string; nome: string; date: Date; arquivo: string };

function PhonesTab({
  records,
  onSaveFile,
}: {
  records: (NotaRecord & { _id?: string; _createdAt?: string })[];
  onSaveFile: (blob: Blob, name: string, kind: "pdf", count: number) => Promise<void>;
}) {
  const today = useMemo(() => toLocalDateInput(new Date()), []);
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState<string>("D4S · NOTA — Números");
  const [subtitle, setSubtitle] = useState<string>("");

  const entries = useMemo<PhoneEntry[]>(() => {
    return records
      .filter((r) => r.telefone)
      .map((r) => ({
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
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [entries, from, to]);

  const copyAll = async () => {
    if (filtered.length === 0) return toast.error("Nenhum número no período");
    await navigator.clipboard.writeText(filtered.map((e) => e.telefone).join("\n"));
    toast.success(`${filtered.length} número(s) copiado(s)`);
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
          <Button variant="outline" size="sm" onClick={copyAll} disabled={filtered.length === 0}>
            <Copy className="w-4 h-4 mr-2" /> Copiar todos
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
                <div className="text-sm font-medium truncate">{e.telefone}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {e.nome || "Sem nome"} ·{" "}
                  {e.date.getTime() > 0 ? e.date.toLocaleString("pt-BR") : "—"}
                </div>
              </div>
              <CopyButton value={e.telefone} label="telefone" />
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
