import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  CameraOff,
  Loader2,
  Sparkles,
  Copy,
  CheckCheck,
  Trash2,
  Download,
  FileSpreadsheet,
  FileType,
  FileText,
  ArrowLeft,
  Zap,
  ZapOff,
  ShieldAlert,
  Settings,
  RefreshCw,
  Smartphone,
  Share,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractFromFiles, type NotaRecord } from "@/lib/nota.functions";

export const Route = createFileRoute("/mobile")({
  head: () => ({
    meta: [
      { title: "NOTA Mobile · Scanner ao vivo" },
      {
        name: "description",
        content:
          "Versão mobile do NOTA: aponte a câmera e os dados são extraídos automaticamente, sem precisar tirar foto.",
      },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: MobileScanner,
});

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

function MobileScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevHashRef = useRef<number[] | null>(null);
  const stableCountRef = useRef(0);
  const busyRef = useRef(false);
  const lastSentAtRef = useRef(0);

  const [streaming, setStreaming] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [records, setRecords] = useState<NotaRecord[]>([]);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState("Aponte para um documento");
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [permissionState, setPermissionState] = useState<
    "idle" | "requesting" | "denied" | "unavailable" | "granted"
  >("idle");
  const [permissionError, setPermissionError] = useState<string>("");

  // PWA install
  const [installPrompt, setInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  const extract = useServerFn(extractFromFiles);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem("nota.records");
      if (saved) setRecords(JSON.parse(saved));
    } catch {}
    // iOS detection
    const ua = navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    setIsIos(iOS);
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(
        e as unknown as {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        },
      );
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      try {
        await installPrompt.userChoice;
      } catch {}
      setInstallPrompt(null);
      return;
    }
    if (isIos) {
      setShowIosHelp(true);
      return;
    }
    toast.info("Use o menu do navegador → Instalar aplicativo");
  };

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("nota.records", JSON.stringify(records));
    } catch {}
  }, [records, mounted]);

  const startCamera = async () => {
    setPermissionError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState("unavailable");
      setPermissionError(
        "Este navegador não permite acesso à câmera. Use Chrome ou Safari atualizado.",
      );
      return;
    }
    if (!window.isSecureContext) {
      setPermissionState("unavailable");
      setPermissionError(
        "A câmera só funciona em conexões seguras (HTTPS). Abra a versão publicada do app.",
      );
      return;
    }
    setPermissionState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // torch detection
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(!!caps.torch);
      setStreaming(true);
      setPermissionState("granted");
      setStatus("Aponte para um documento e segure firme");
    } catch (e: unknown) {
      console.error(e);
      const err = e as { name?: string; message?: string };
      const name = err?.name || "";
      if (
        name === "NotAllowedError" ||
        name === "SecurityError" ||
        name === "PermissionDeniedError"
      ) {
        setPermissionState("denied");
        setPermissionError(
          "Você bloqueou o acesso à câmera. Permita o uso nas configurações do navegador e tente novamente.",
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setPermissionState("unavailable");
        setPermissionError("Nenhuma câmera foi encontrada neste dispositivo.");
      } else if (name === "NotReadableError") {
        setPermissionState("unavailable");
        setPermissionError(
          "A câmera está em uso por outro aplicativo. Feche-o e tente de novo.",
        );
      } else {
        setPermissionState("denied");
        setPermissionError(
          err?.message || "Não foi possível abrir a câmera. Tente novamente.",
        );
      }
    }
  };

  const stopCamera = () => {
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
    setStreaming(false);
    setTorchOn(false);
    setTorchSupported(false);
  };

  const toggleTorch = async () => {
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as unknown as MediaTrackConstraintSet],
      });
      setTorchOn((t) => !t);
    } catch {
      toast.error("Lanterna não suportada");
    }
  };

  useEffect(() => () => stopCamera(), []);

  // Hash a downscaled grayscale frame for stability detection
  const computeHash = (): number[] | null => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.videoWidth === 0) return null;
    const W = 16,
      H = 16;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const out: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      out.push(Math.round((data[i]! + data[i + 1]! + data[i + 2]!) / 3 / 16));
    }
    return out;
  };

  const hashDiff = (a: number[], b: number[]) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
    return d / a.length;
  };

  const captureBlob = async (): Promise<{ base64: string; mime: string } | null> => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    const maxW = 1600;
    const scale = Math.min(1, maxW / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => {
            const r = reader.result as string;
            resolve({ base64: r.split(",")[1] ?? "", mime: "image/jpeg" });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        0.85,
      );
    });
  };

  const isDuplicate = (rec: NotaRecord) => {
    return records.some(
      (r) =>
        (rec.cpf && r.cpf && r.cpf === rec.cpf) ||
        (rec.nome && r.nome && r.nome.toLowerCase() === rec.nome.toLowerCase() && r.email === rec.email),
    );
  };

  const scanNow = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setProcessing(true);
    setStatus("Lendo documento...");
    try {
      const cap = await captureBlob();
      if (!cap) return;
      const res = await extract({
        data: {
          files: [
            {
              name: `scan_${Date.now()}.jpg`,
              mimeType: cap.mime,
              dataBase64: cap.base64,
            },
          ],
        },
      });
      const rec = res.records[0];
      if (!rec) {
        setStatus("Nada identificado, tente reposicionar");
        return;
      }
      const hasAny = FIELD_ORDER.some((k) => rec[k]);
      if (!hasAny) {
        setStatus("Documento ilegível, ajuste a iluminação");
        return;
      }
      if (isDuplicate(rec)) {
        setStatus("Já capturado, aponte para outro documento");
        return;
      }
      setRecords((prev) => [rec, ...prev]);
      setStatus(`✓ ${rec.nome ?? "Documento"} capturado`);
      toast.success(`Capturado: ${rec.nome ?? "documento"}`);
      // Force a cooldown after a save
      lastSentAtRef.current = Date.now() + 1500;
    } catch (e) {
      console.error(e);
      setStatus("Falha na leitura");
    } finally {
      busyRef.current = false;
      setProcessing(false);
    }
  };

  // Auto-scan loop: checks frame stability ~3x/sec
  useEffect(() => {
    if (!streaming || !autoScan) return;
    const id = window.setInterval(() => {
      if (busyRef.current) return;
      if (Date.now() < lastSentAtRef.current) return;
      const h = computeHash();
      if (!h) return;
      const prev = prevHashRef.current;
      prevHashRef.current = h;
      if (!prev) return;
      const diff = hashDiff(h, prev);
      // diff < 1.2 = quase parado; > 6 = se mexeu muito; precisamos de algo intermediário (documento entrou no quadro)
      if (diff < 1.2) {
        stableCountRef.current += 1;
      } else {
        stableCountRef.current = 0;
      }
      // 4 frames estáveis (~1.3s) e algum conteúdo (variação minima na imagem)
      const variance =
        h.reduce((acc, v, i, arr) => acc + Math.abs(v - arr[Math.max(0, i - 1)]!), 0) / h.length;
      if (stableCountRef.current >= 4 && variance > 1.5) {
        stableCountRef.current = 0;
        lastSentAtRef.current = Date.now() + 2500;
        scanNow();
      }
    }, 350);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, autoScan, records]);

  const allEmails = useMemo(() => {
    const s = new Set<string>();
    records.forEach((r) => r.email && s.add(r.email));
    return Array.from(s);
  }, [records]);

  const exportXlsx = async (emailsOnly = false) => {
    if (records.length === 0) return toast.error("Nenhum registro");
    const XLSX = await import("xlsx");
    const headers = emailsOnly
      ? ["E-mail"]
      : ["Nome", "CPF", "Telefone", "E-mail", "CEP", "Número"];
    const rows = emailsOnly
      ? allEmails.map((e) => ({ "E-mail": e }))
      : records.map((r) => ({
          Nome: r.nome || "",
          CPF: r.cpf || "",
          Telefone: r.telefone || "",
          "E-mail": r.email || "",
          CEP: r.cep || "",
          Número: r.numero || "",
        }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dados");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    download(blob, `mobile_${Date.now()}.xlsx`);
  };

  const exportPdf = async () => {
    if (records.length === 0) return toast.error("Nenhum registro");
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "l" });
    doc.setFontSize(14);
    doc.text("D4S · NOTA Mobile", 14, 14);
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
      startY: 20,
      styles: { fontSize: 8 },
    });
    download(doc.output("blob"), `mobile_${Date.now()}.pdf`);
  };

  const exportDocx = async () => {
    if (records.length === 0) return toast.error("Nenhum registro");
    const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
    const children: InstanceType<typeof Paragraph>[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "D4S · NOTA Mobile", bold: true })],
      }),
    ];
    records.forEach((r, i) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: `Registro ${i + 1}`, bold: true })],
        }),
      );
      FIELD_ORDER.forEach((k) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${FIELD_LABELS[k]}: `, bold: true }),
              new TextRun({ text: r[k] ? String(r[k]) : "" }),
            ],
          }),
        );
      });
      children.push(new Paragraph({ text: "" }));
    });
    const docx = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(docx);
    download(blob, `mobile_${Date.now()}.docx`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Toaster richColors position="top-center" />
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Desktop
          </Link>
          <div className="flex items-center gap-2 font-semibold">
            NOTA <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
            Mobile
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <Card className="p-0 overflow-hidden relative bg-black aspect-[3/4] sm:aspect-video">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Frame overlay */}
          {streaming && (
            <>
              <div className="pointer-events-none absolute inset-6 border-2 border-white/70 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
                <span
                  className={`text-xs px-2 py-1 rounded-full backdrop-blur ${
                    processing
                      ? "bg-primary/80 text-primary-foreground"
                      : "bg-black/60 text-white"
                  }`}
                >
                  {processing ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> {status}
                    </span>
                  ) : (
                    status
                  )}
                </span>
                {torchSupported && (
                  <button
                    onClick={toggleTorch}
                    className="p-2 rounded-full bg-black/60 text-white backdrop-blur"
                    aria-label="Lanterna"
                  >
                    {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </>
          )}

          {!streaming && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80 text-sm p-6 text-center">
              <Camera className="w-12 h-12 opacity-70" />
              <p>Toque em iniciar para abrir a câmera</p>
            </div>
          )}
        </Card>

        <div className="flex items-center gap-3">
          {!streaming ? (
            <Button onClick={startCamera} className="flex-1" size="lg">
              <Camera className="w-4 h-4 mr-2" /> Iniciar câmera
            </Button>
          ) : (
            <>
              <Button onClick={stopCamera} variant="outline" size="lg">
                <CameraOff className="w-4 h-4" />
              </Button>
              <Button onClick={scanNow} disabled={processing} className="flex-1" size="lg">
                {processing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Capturar agora
              </Button>
            </>
          )}
        </div>

        {streaming && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/30">
            <Label htmlFor="auto" className="text-sm">
              Captura automática
            </Label>
            <Switch id="auto" checked={autoScan} onCheckedChange={setAutoScan} />
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">
              Capturados {mounted ? `(${records.length})` : ""}
            </h2>
            {records.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Limpar todos os registros?")) {
                    setRecords([]);
                  }
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          {records.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="outline" onClick={exportDocx}>
                <FileType className="w-4 h-4 mr-1" /> Word
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportXlsx(false)}>
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
              </Button>
              <Button size="sm" variant="outline" onClick={exportPdf}>
                <FileText className="w-4 h-4 mr-1" /> PDF
              </Button>
            </div>
          )}

          <div className="space-y-3">
            {records.map((r, idx) => (
              <MobileRecord
                key={idx}
                record={r}
                onDelete={() => setRecords((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))}
            {records.length === 0 && (
              <Card className="p-8 text-center text-muted-foreground text-sm">
                Nenhum documento capturado ainda.
              </Card>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function MobileRecord({
  record,
  onDelete,
}: {
  record: NotaRecord;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    const text = FIELD_ORDER.map((k) => `${FIELD_LABELS[k]}: ${record[k] ?? ""}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
    toast.success("Copiado");
  };
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">
            {record.nome || <span className="italic text-muted-foreground">Sem nome</span>}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={copyAll}>
          {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Remover">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-sm">
        {FIELD_ORDER.map((k) => (
          <FieldLine key={k} label={FIELD_LABELS[k]} value={record[k] ?? ""} />
        ))}
      </dl>
    </Card>
  );
}

function FieldLine({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  const v = value && String(value).trim() ? String(value) : "—";
  return (
    <>
      <dt className="text-xs text-muted-foreground self-center">{label}</dt>
      <dd className="flex items-center justify-between gap-2 min-w-0">
        <span className="truncate">{v}</span>
        {v !== "—" && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(v);
              setCopied(true);
              setTimeout(() => setCopied(false), 1000);
            }}
            className="text-muted-foreground hover:text-primary shrink-0"
            aria-label={`Copiar ${label}`}
          >
            {copied ? <CheckCheck className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
          </button>
        )}
      </dd>
    </>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}