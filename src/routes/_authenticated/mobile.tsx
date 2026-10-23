import { createFileRoute } from "@tanstack/react-router";
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
  Zap,
  ZapOff,
  ShieldAlert,
  Settings,
  RefreshCw,
  Smartphone,
  Share,
  ScanLine,
  List,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractFromFiles, type NotaRecord } from "@/lib/nota.functions";
import { useCloudRecords, useCloudFiles } from "@/lib/nota-sync";
import { sanitizeRecord } from "@/lib/record-format";

export const Route = createFileRoute("/_authenticated/mobile")({
  head: () => ({
    meta: [
      { title: "NOTA Mobile · Scanner ao vivo" },
      { property: "og:title", content: "NOTA Mobile · Scanner ao vivo" },
      { property: "og:description", content: "Scanner de documentos NOTA no celular, com dados salvos na sua conta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "description",
        content:
          "Versão mobile do NOTA: aponte a câmera e os dados são extraídos automaticamente, sem precisar tirar foto.",
      },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
    ],
  }),
  component: MobileScanner,
  errorComponent: MobileErrorFallback,
});

function MobileErrorFallback({ error, reset }: { error: any; reset: () => void }) {
  console.error("[NOTA mobile] route error", error);
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-background">
      <div className="max-w-sm text-center space-y-4">
        <ShieldAlert className="w-10 h-10 mx-auto text-amber-500" />
        <h1 className="text-lg font-semibold">Não foi possível abrir o scanner</h1>
        <p className="text-sm text-muted-foreground">
          Tente novamente. Se persistir, feche e reabra o app.
        </p>
        <div className="flex gap-2 justify-center">
          <Button size="sm" onClick={() => reset()}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Tentar novamente
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
  const streamRef = useRef<MediaStream | null>(null);
  const prevHashRef = useRef<number[] | null>(null);
  const stableCountRef = useRef(0);
  const busyRef = useRef(false);
  const lastSentAtRef = useRef(0);

  const [streaming, setStreaming] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [tab, setTab] = useState<"scan" | "list">("scan");
  const [showExport, setShowExport] = useState(false);
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

  const attachStream = async (stream: MediaStream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      const video = videoRef.current;
      video.setAttribute("autoplay", "true");
      video.setAttribute("playsinline", "true");
      video.muted = true;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (playErr) {
        console.warn("[NOTA] video.play() rejected", playErr);
      }
    }
    stream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        setStreaming(false);
        setTorchOn(false);
        setTorchSupported(false);
        setStatus("Câmera pausada. Toque em iniciar para continuar.");
      };
    });
  };

  const startCamera = async () => {
    setPermissionError("");
    const existingTrack = streamRef.current?.getVideoTracks()[0];
    if (existingTrack?.readyState === "live") {
      await attachStream(streamRef.current!);
      setStreaming(true);
      setPermissionState("granted");
      setStatus("Câmera ativa");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState("unavailable");
      setPermissionError(
        "Este navegador não permite acesso à câmera. Use Chrome ou Safari atualizado.",
      );
      return;
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
      await attachStream(stream);
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
    const stream = streamRef.current ?? (v?.srcObject as MediaStream | null);
    stream?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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

  useEffect(() => {
    const resumeVideo = () => {
      const video = videoRef.current;
      const stream = streamRef.current;
      if (!video || !stream || document.hidden) return;
      if (video.srcObject !== stream) video.srcObject = stream;
      if (video.paused && stream.getVideoTracks().some((track) => track.readyState === "live")) {
        video.play().catch((err) => console.warn("[NOTA] resume camera preview failed", err));
      }
    };
    document.addEventListener("visibilitychange", resumeVideo);
    window.addEventListener("focus", resumeVideo);
    return () => {
      document.removeEventListener("visibilitychange", resumeVideo);
      window.removeEventListener("focus", resumeVideo);
    };
  }, []);

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

  const recordsRef = useRef(records);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  const isDuplicate = (rec: NotaRecord) => {
    return recordsRef.current.some(
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
      const contacts = res.records.map(raw => sanitizeRecord(raw)).filter(rec => FIELD_ORDER.some(k => rec[k]) || rec.uh);
      if (!contacts.length) {
        setStatus("Nada identificado, tente reposicionar");
        return;
      }
      for (const rec of contacts) await addOne(rec);
      setStatus(`✓ ${contacts.length} contato(s) capturado(s)`);
      toast.success(`Capturado: ${contacts[0]?.nome || "documento"} · ${contacts.length} contato(s)`);
      // Small cooldown after a save so the same page isn't re-read instantly
      lastSentAtRef.current = Date.now() + 800;
    } catch (e) {
      console.error(e);
      setStatus("Falha na leitura");
    } finally {
      busyRef.current = false;
      setProcessing(false);
    }
  };

  // Auto-scan loop: checks frame stability ~5x/sec for faster, more accurate capture
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
      if (diff < 1.6) {
        stableCountRef.current += 1;
      } else {
        stableCountRef.current = 0;
      }
      const variance =
        h.reduce((acc, v, i, arr) => acc + Math.abs(v - arr[Math.max(0, i - 1)]!), 0) / h.length;
      if (stableCountRef.current >= 2 && variance > 1.2) {
        stableCountRef.current = 0;
        lastSentAtRef.current = Date.now() + 1500;
        scanNow();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, autoScan]);

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
    <div
      className="fixed inset-0 flex flex-col bg-background text-foreground overflow-hidden select-none"
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
    >
      <Toaster richColors position="top-center" />

      {/* iOS/Android status bar spacer + top bar */}
      <header
        className="shrink-0 bg-background/80 backdrop-blur-xl border-b border-border/40 z-20"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold tracking-tight">NOTA</span>
          </div>
          <div className="flex items-center gap-2">
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/60" />
            )}
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {syncing ? "sync" : "live"}
            </span>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT — swappable via bottom tabs */}
      <main className="flex-1 relative overflow-hidden">
        {tab === "scan" ? (
          <div className="absolute inset-0 bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Scanner viewfinder + status */}
            {streaming && (
              <>
                <div className="pointer-events-none absolute inset-x-6 top-16 bottom-40 rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                  {/* corner brackets */}
                  <span className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-3xl" />
                  <span className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-3xl" />
                  <span className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-3xl" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-3xl" />
                  {autoScan && (
                    <span className="absolute left-2 right-2 top-1/2 h-0.5 bg-primary/80 shadow-[0_0_12px] shadow-primary animate-pulse" />
                  )}
                </div>

                <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
                  <span
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full backdrop-blur ${
                      processing
                        ? "bg-primary/90 text-primary-foreground"
                        : "bg-black/55 text-white"
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
                      className="pointer-events-auto p-2.5 rounded-full bg-black/55 text-white backdrop-blur active:scale-95 transition"
                      aria-label="Lanterna"
                    >
                      {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
                    </button>
                  )}
                </div>

                {/* Auto scan toggle chip */}
                <div className="absolute left-1/2 -translate-x-1/2 top-16 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur text-white text-xs">
                  <Label htmlFor="auto" className="text-xs cursor-pointer">
                    Auto
                  </Label>
                  <Switch id="auto" checked={autoScan} onCheckedChange={setAutoScan} />
                </div>
              </>
            )}

            {/* Camera placeholder / permission states */}
            {!streaming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/85 text-sm p-8 text-center bg-black">
                {permissionState === "denied" || permissionState === "unavailable" ? (
                  <PermissionHelp
                    state={permissionState}
                    message={permissionError}
                    onRetry={startCamera}
                    inIframe={inIframe}
                    publishedUrl={PUBLISHED_URL}
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
                    <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
                      <Camera className="w-10 h-10 opacity-90" />
                    </div>
                    <p className="text-base font-medium">Scanner NOTA</p>
                    <p className="text-xs text-white/70 max-w-[240px]">
                      Aponte a câmera para um documento e o app extrai os dados automaticamente.
                    </p>
                    <Button
                      onClick={startCamera}
                      size="lg"
                      className="rounded-full px-6 h-11 shadow-lg shadow-primary/40"
                    >
                      <Camera className="w-4 h-4 mr-2" /> Iniciar câmera
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Floating shutter + controls */}
            {streaming && (
              <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-6 pointer-events-none">
                <button
                  onClick={stopCamera}
                  className="pointer-events-auto w-12 h-12 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center active:scale-90 transition"
                  aria-label="Pausar câmera"
                >
                  <CameraOff className="w-5 h-5" />
                </button>
                <button
                  onClick={scanNow}
                  disabled={processing}
                  className="pointer-events-auto relative w-20 h-20 rounded-full bg-white flex items-center justify-center active:scale-95 transition disabled:opacity-70 shadow-2xl"
                  aria-label="Capturar"
                >
                  <span className="absolute inset-1.5 rounded-full border-4 border-primary" />
                  {processing ? (
                    <Loader2 className="w-7 h-7 animate-spin text-primary" />
                  ) : (
                    <span className="w-14 h-14 rounded-full bg-primary" />
                  )}
                </button>
                <button
                  onClick={() => setTab("list")}
                  className="pointer-events-auto relative w-12 h-12 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center active:scale-90 transition"
                  aria-label="Registros"
                >
                  <List className="w-5 h-5" />
                  {records.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {records.length}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 overflow-y-auto overscroll-contain">
            <div className="px-4 pt-4 pb-32 space-y-4">
              {!installed && (
                <button
                  onClick={handleInstall}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border border-primary/30 bg-primary/5 text-left active:scale-[0.99] transition"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">Instalar como app</div>
                    <p className="text-xs text-muted-foreground">
                      {isIos
                        ? "Toque aqui para ver como adicionar à tela inicial."
                        : "Adicione à tela inicial para abrir sem o navegador."}
                    </p>
                  </div>
                  {isIos ? (
                    <Share className="w-4 h-4 text-primary shrink-0" />
                  ) : (
                    <Plus className="w-4 h-4 text-primary shrink-0" />
                  )}
                </button>
              )}

              {showIosHelp && (
                <Card className="p-4 rounded-2xl space-y-2 text-sm">
                  <div className="font-semibold flex items-center gap-2">
                    <Share className="w-4 h-4" /> Instalar no iPhone / iPad
                  </div>
                  <ol className="list-decimal pl-5 space-y-1 text-muted-foreground text-xs">
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
                <Card className="p-4 rounded-2xl space-y-3 text-sm">
                  <div className="font-semibold flex items-center gap-2">
                    <Smartphone className="w-4 h-4" /> Como instalar o app
                  </div>
                  {inIframe && (
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                      <p>Abra o app em uma aba própria para poder instalar:</p>
                      <Button asChild size="sm">
                        <a href={PUBLISHED_URL} target="_blank" rel="noreferrer">
                          Abrir em nova aba
                        </a>
                      </Button>
                    </div>
                  )}
                  <ol className="list-decimal pl-5 space-y-1 text-muted-foreground text-xs">
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
                  <Button size="sm" variant="ghost" onClick={() => setShowInstallHelp(false)}>
                    Fechar
                  </Button>
                </Card>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Capturados</h2>
                  <p className="text-xs text-muted-foreground">
                    {records.length} {records.length === 1 ? "registro" : "registros"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {records.length > 0 && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full h-9"
                        onClick={() => setShowExport(true)}
                      >
                        <Download className="w-4 h-4 mr-1" /> Exportar
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="rounded-full"
                        onClick={() => {
                          if (confirm("Limpar todos os registros?")) clearAll();
                        }}
                        aria-label="Limpar tudo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {records.map((r) => (
                  <MobileRecord
                    key={r._id ?? r._arquivo}
                    record={r}
                    onDelete={() => removeOne(r._id)}
                  />
                ))}
                {records.length === 0 && (
                  <div className="mt-16 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                    <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                      <ScanLine className="w-8 h-8 opacity-60" />
                    </div>
                    <p className="text-sm">Nenhum documento capturado ainda.</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setTab("scan")}
                    >
                      <Camera className="w-4 h-4 mr-1.5" /> Abrir scanner
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Export bottom sheet */}
      {showExport && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in"
          onClick={() => setShowExport(false)}
        >
          <div
            className="absolute bottom-0 inset-x-0 bg-background rounded-t-3xl p-5 space-y-3 animate-in slide-in-from-bottom"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/30" />
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Exportar registros</h3>
              <button
                onClick={() => setShowExport(false)}
                className="p-1.5 rounded-full active:bg-muted"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <SheetAction icon={FileType} label="Word" onClick={() => { exportDocx(); setShowExport(false); }} />
              <SheetAction icon={FileSpreadsheet} label="Excel" onClick={() => { exportXlsx(false); setShowExport(false); }} />
              <SheetAction icon={FileText} label="PDF" onClick={() => { exportPdf(); setShowExport(false); }} />
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav
        className="shrink-0 border-t border-border/60 bg-background/90 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-2 h-16">
          <TabButton
            active={tab === "scan"}
            icon={ScanLine}
            label="Scanner"
            onClick={() => setTab("scan")}
          />
          <TabButton
            active={tab === "list"}
            icon={List}
            label="Registros"
            badge={records.length}
            onClick={() => setTab("list")}
          />
        </div>
      </nav>
    </div>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-0.5 transition active:scale-95 ${
        active ? "text-primary" : "text-muted-foreground"
      }`}
    >
      <div className="relative">
        <Icon className={`w-6 h-6 ${active ? "" : "opacity-80"}`} />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
      </div>
      <span className={`text-[10px] font-medium ${active ? "" : "opacity-70"}`}>{label}</span>
      {active && <span className="absolute top-0 w-8 h-0.5 rounded-b-full bg-primary" />}
    </button>
  );
}

function SheetAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border border-border bg-card active:scale-95 transition"
    >
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-xs font-medium">{label}</span>
    </button>
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
  inIframe,
  publishedUrl,
}: {
  state: "denied" | "unavailable";
  message: string;
  onRetry: () => void;
  inIframe?: boolean;
  publishedUrl?: string;
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
      {inIframe && publishedUrl && (
        <Button asChild size="sm">
          <a href={publishedUrl} target="_blank" rel="noreferrer">
            Abrir em nova aba
          </a>
        </Button>
      )}
      {denied && !inIframe && (
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