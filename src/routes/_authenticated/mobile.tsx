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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractFromFiles, type NotaRecord } from "@/lib/nota.functions";
import { useCloudRecords, useCloudFiles } from "@/lib/nota-sync";

export const Route = createFileRoute("/_authenticated/mobile")({
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
  errorComponent: MobileErrorFallback,
});

function MobileErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[NOTA mobile] route error", error);
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-sm text-center space-y-4">
        <ShieldAlert className="w-10 h-10 mx-auto text-amber-500" />
        <h1 className="text-lg font-semibold">Não foi possível abrir o scanner</h1>
        <p className="text-sm text-muted-foreground">
          Tente novamente. Se persistir, atualize a página ou volte ao desktop.
        </p>
        <div className="flex gap-2 justify-center">
          <Button size="sm" onClick={() => reset()}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Tentar novamente
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/">Voltar</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  const [autoScan, setAutoScan] = useState(false);
  const [processing, setProcessing] = useState(false);
  const {
    records,
    syncing: syncingRecords,
    addOne,
    removeOne,
    clearAll,
  } = useCloudRecords();
  const { saveFile, syncing: syncingFiles } = useCloudFiles();
  const syncing = syncingRecords || syncingFiles;
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
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [inIframe, setInIframe] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  const extract = useServerFn(extractFromFiles);

  useEffect(() => {
    // iOS detection
    const ua = navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    setIsIos(iOS);
    setIsAndroid(/Android/i.test(ua));
    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true);
    }
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
    setShowInstallHelp(true);
  };

  const PUBLISHED_URL = "https://clever-nota-scan.lovable.app/mobile";

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
    // Detect iframe embedding without failing preemptively — some browsers
    // report featurePolicy incorrectly and rejecting here caused the
    // "erro ao iniciar" the user saw. We just observe and let getUserMedia
    // decide, then explain the failure if it happens.
    let embedded = false;
    try {
      embedded = window.self !== window.top;
    } catch {
      embedded = true;
    }
    // Kick off getUserMedia SYNCHRONOUSLY inside the user gesture to preserve
    // gesture provenance (some browsers block media APIs after async breaks).
    // getUserMedia returns a Promise; it does not throw synchronously, so no
    // try/catch is needed around the call itself.
    const primary = navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    setPermissionState("requesting");
    try {
      let stream: MediaStream;
      try {
        stream = await primary;
      } catch (err) {
        const name = (err as { name?: string })?.name || "";
        // Fallback to simplest constraints if the device rejects the ideal ones
        // (common on desktops without a rear camera, or older webcams).
        if (
          name === "OverconstrainedError" ||
          name === "ConstraintNotSatisfiedError" ||
          name === "NotReadableError"
        ) {
          console.warn("[NOTA] camera fallback after", name);
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw err;
        }
      }
      if (videoRef.current) {
        const video = videoRef.current;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        video.srcObject = stream;
        // Don't fail the whole flow if autoplay is blocked — the stream is live.
        try {
          await video.play();
        } catch (playErr) {
          console.warn("[NOTA] video.play() rejected", playErr);
        }
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
          embedded
            ? "Câmera bloqueada. Se estiver vendo pelo editor, abra o app em uma aba própria e permita o acesso quando o navegador perguntar."
            : "Você bloqueou o acesso à câmera. Permita o uso nas configurações do navegador e tente novamente.",
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

  // Safety net: never let a stray promise rejection from MediaStream / Supabase
  // realtime tear down the route and trigger the root error boundary.
  useEffect(() => {
    const onRej = (e: PromiseRejectionEvent) => {
      const msg = String(e.reason?.message ?? e.reason ?? "");
      if (
        /getUserMedia|MediaStream|NotAllowed|NotReadable|NotFound|Overconstrained|play\(\)/i.test(
          msg,
        )
      ) {
        e.preventDefault();
        console.warn("[NOTA] swallowed media rejection", e.reason);
      }
    };
    window.addEventListener("unhandledrejection", onRej);
    return () => window.removeEventListener("unhandledrejection", onRej);
  }, []);

  // Hash a downscaled grayscale frame for stability detection
  const computeHash = (): number[] | null => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.videoWidth === 0) return null;
    const W = 8,
      H = 8;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
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
      await addOne(rec);
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
      if (diff < 1.2) {
        stableCountRef.current += 1;
      } else {
        stableCountRef.current = 0;
      }
      const variance =
        h.reduce((acc, v, i, arr) => acc + Math.abs(v - arr[Math.max(0, i - 1)]!), 0) / h.length;
      if (stableCountRef.current >= 3 && variance > 1.5) {
        stableCountRef.current = 0;
        lastSentAtRef.current = Date.now() + 3000;
        scanNow();
      }
    }, 700);
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
    const name = `mobile_${Date.now()}.xlsx`;
    download(blob, name);
    saveFile(blob, name, "xlsx", records.length).catch(() => {});
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
    const blob = doc.output("blob");
    const name = `mobile_${Date.now()}.pdf`;
    download(blob, name);
    saveFile(blob, name, "pdf", records.length).catch(() => {});
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
    const name = `mobile_${Date.now()}.docx`;
    download(blob, name);
    saveFile(blob, name, "docx", records.length).catch(() => {});
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
          <div className="flex items-center gap-2">
            {syncing ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> sync
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                ☁ sync
              </span>
            )}
            <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
              Mobile
            </span>
          </div>
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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/85 text-sm p-6 text-center">
              {permissionState === "denied" || permissionState === "unavailable" ? (
                <PermissionHelp
                  state={permissionState}
                  message={permissionError}
                  onRetry={startCamera}
                />
              ) : permissionState === "requesting" ? (
                <>
                  <Loader2 className="w-10 h-10 animate-spin opacity-80" />
                  <p>Solicitando acesso à câmera...</p>
                  <p className="text-xs text-white/60">
                    Toque em "Permitir" no aviso do navegador.
                  </p>
                </>
              ) : (
                <>
                  <Camera className="w-12 h-12 opacity-70" />
                  <p>Toque em iniciar para abrir a câmera</p>
                </>
              )}
            </div>
          )}
        </Card>

        {!installed && (
          <Card className="p-3 flex items-center gap-3 border-primary/30 bg-primary/5">
            <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Instalar o app NOTA</div>
              <p className="text-xs text-muted-foreground">
                Adicione à tela inicial para abrir como um aplicativo.
              </p>
            </div>
            <Button size="sm" onClick={handleInstall}>
              {isIos ? (
                <>
                  <Share className="w-4 h-4 mr-1" /> Como?
                </>
              ) : (
                <>
                  <Smartphone className="w-4 h-4 mr-1" /> Instalar
                </>
              )}
            </Button>
          </Card>
        )}

        {showIosHelp && (
          <Card className="p-4 space-y-2 text-sm">
            <div className="font-semibold flex items-center gap-2">
              <Share className="w-4 h-4" /> Instalar no iPhone / iPad
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
              <li>Toque no botão Compartilhar do Safari.</li>
              <li>Escolha "Adicionar à Tela de Início".</li>
              <li>Confirme em "Adicionar". O NOTA aparecerá como app.</li>
            </ol>
            <Button size="sm" variant="ghost" onClick={() => setShowIosHelp(false)}>
              Fechar
            </Button>
          </Card>
        )}

        {showInstallHelp && (
          <Card className="p-4 space-y-3 text-sm">
            <div className="font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4" /> Como instalar o app
            </div>
            {inIframe && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <p className="font-medium">
                  Você está vendo o app dentro do editor. Para instalar, abra o app em uma aba própria:
                </p>
                <Button asChild size="sm" variant="default">
                  <a href={PUBLISHED_URL} target="_blank" rel="noreferrer">
                    Abrir app em nova aba
                  </a>
                </Button>
              </div>
            )}
            <div>
              <div className="font-medium mb-1">
                {isAndroid ? "Android / Chrome:" : "Chrome / Edge no computador:"}
              </div>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Abra o menu do navegador (⋮).</li>
                <li>
                  Toque em{" "}
                  <span className="font-medium">
                    {isAndroid ? "Adicionar à tela inicial" : "Instalar aplicativo"}
                  </span>
                  .
                </li>
                <li>Confirme. O NOTA abre como app independente.</li>
              </ol>
            </div>
            <p className="text-xs text-muted-foreground">
              Dica: se a opção não aparecer, recarregue a página depois de carregar tudo uma vez.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setShowInstallHelp(false)}>
              Fechar
            </Button>
          </Card>
        )}

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
              Capturados ({records.length})
            </h2>
            {records.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Limpar todos os registros?")) {
                    clearAll();
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
            {records.map((r) => (
              <MobileRecord
                key={r._id ?? r._arquivo}
                record={r}
                onDelete={() => removeOne(r._id)}
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

function PermissionHelp({
  state,
  message,
  onRetry,
}: {
  state: "denied" | "unavailable";
  message: string;
  onRetry: () => void;
}) {
  const denied = state === "denied";
  return (
    <div className="flex flex-col items-center gap-3 max-w-sm">
      <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
        <ShieldAlert className="w-7 h-7 text-amber-300" />
      </div>
      <div className="font-semibold text-white text-base">
        {denied ? "Acesso à câmera bloqueado" : "Câmera indisponível"}
      </div>
      <p className="text-xs text-white/75 leading-relaxed">
        {message ||
          "Não foi possível acessar a câmera deste dispositivo."}
      </p>
      {denied && (
        <div className="text-left text-xs text-white/70 bg-white/5 rounded-md p-3 w-full space-y-1.5">
          <div className="font-medium text-white/90 flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Como liberar:
          </div>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Toque no ícone de cadeado na barra de endereço.</li>
            <li>
              Em <span className="font-medium">Permissões</span>, ative a{" "}
              <span className="font-medium">Câmera</span>.
            </li>
            <li>Recarregue a página e toque em "Tentar novamente".</li>
          </ol>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="w-4 h-4 mr-1.5" /> Tentar novamente
        </Button>
        {denied && (
          <Button
            size="sm"
            variant="outline"
            className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </Button>
        )}
      </div>
    </div>
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