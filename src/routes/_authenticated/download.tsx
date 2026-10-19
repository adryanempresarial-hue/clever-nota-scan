import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Smartphone,
  Monitor,
  Apple,
  Download,
  ExternalLink,
  CheckCircle2,
  Share,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/_authenticated/download")({
  head: () => ({
    meta: [
      { title: "Baixar app NOTA · Instalar no celular e desktop" },
      { property: "og:title", content: "Baixar app NOTA · Instalar no celular e desktop" },
      { property: "og:description", content: "Instale o NOTA no celular ou computador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "description",
        content:
          "Baixe o NOTA como aplicativo instalável no Android, iPhone, Windows, macOS e Linux.",
      },
    ],
  }),
  component: DownloadPage,
});

const PUBLISHED_URL = "https://clever-nota-scan.lovable.app";
const PWABUILDER_URL = `https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(
  PUBLISHED_URL,
)}`;

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function DownloadPage() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [inIframe, setInIframe] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop" | "unknown">(
    "unknown",
  );

  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true);
    }
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) setPlatform("ios");
    else if (/android/.test(ua)) setPlatform("android");
    else setPlatform("desktop");

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      toast.success("App instalado com sucesso!");
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferred) {
      toast.info("Use o menu do navegador → 'Instalar app' ou 'Adicionar à Tela de Início'.");
      return;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setDeferred(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <Toaster richColors position="top-center" />
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="w-4 h-4 text-primary" /> Baixar NOTA
          </div>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Instale o NOTA como aplicativo</h1>
          <p className="text-muted-foreground">
            Funciona no Android, iPhone, Windows, macOS e Linux. Mesmo login = mesmos dados.
          </p>
        </div>

        {inIframe && (
          <Card className="p-4 border-amber-500/40 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <ExternalLink className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">
                  Você está visualizando dentro do editor do Lovable.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  A instalação só funciona quando o site é aberto em uma aba própria.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => window.open(`${PUBLISHED_URL}/download`, "_blank")}
                >
                  Abrir em nova aba <ExternalLink className="w-3.5 h-3.5 ml-2" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {installed && (
          <Card className="p-4 border-green-500/40 bg-green-500/5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <p className="text-sm font-medium">App já está instalado neste dispositivo.</p>
            </div>
          </Card>
        )}

        {/* Android */}
        <Card className={`p-5 ${platform === "android" ? "ring-2 ring-primary" : ""}`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Smartphone className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-lg">Android</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Instale direto pelo Chrome ou gere um APK assinado para distribuir.
              </p>
              <div className="space-y-2">
                <Button onClick={handleInstall} disabled={inIframe} className="w-full sm:w-auto">
                  <Download className="w-4 h-4 mr-2" /> Instalar agora (Chrome)
                </Button>
                <div className="text-xs text-muted-foreground">
                  ou gere um APK para baixar:
                </div>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => window.open(PWABUILDER_URL, "_blank")}
                >
                  Gerar APK no PWABuilder <ExternalLink className="w-3.5 h-3.5 ml-2" />
                </Button>
                <p className="text-xs text-muted-foreground pt-1">
                  No PWABuilder: clique em <b>Package For Stores → Android</b> e baixe o{" "}
                  <b>.apk</b> (teste) ou <b>.aab</b> (Google Play).
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* iOS */}
        <Card className={`p-5 ${platform === "ios" ? "ring-2 ring-primary" : ""}`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Apple className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-lg">iPhone / iPad</h2>
              <p className="text-sm text-muted-foreground mb-3">
                A Apple não permite APK. Use "Adicionar à Tela de Início" pelo Safari.
              </p>
              <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                <li>
                  Abra <b>{PUBLISHED_URL}</b> no <b>Safari</b> (não Chrome).
                </li>
                <li>
                  Toque no botão <Share className="w-4 h-4 inline mx-1" /> <b>Compartilhar</b>.
                </li>
                <li>
                  Role e toque em <b>"Adicionar à Tela de Início"</b>.
                </li>
                <li>
                  Confirme em <b>"Adicionar"</b>. O ícone aparece como app nativo.
                </li>
              </ol>
            </div>
          </div>
        </Card>

        {/* Desktop */}
        <Card className={`p-5 ${platform === "desktop" ? "ring-2 ring-primary" : ""}`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Monitor className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-lg">Windows / macOS / Linux</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Instale como aplicativo de janela própria pelo Chrome, Edge ou Brave.
              </p>
              <Button onClick={handleInstall} disabled={inIframe} className="w-full sm:w-auto">
                <Download className="w-4 h-4 mr-2" /> Instalar no desktop
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                Alternativa: ícone de instalação <Download className="w-3 h-3 inline" /> na barra de
                endereço do navegador, ou menu ⋮ → <b>"Instalar NOTA…"</b>.
              </p>
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-2">
                  Quer um instalador <b>.exe</b>, <b>.msi</b> ou <b>.dmg</b>?
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(PWABUILDER_URL, "_blank")}
                >
                  Gerar pelo PWABuilder <ExternalLink className="w-3.5 h-3.5 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 bg-muted/40">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Por que isso funciona?
          </h3>
          <p className="text-sm text-muted-foreground">
            O NOTA é um <b>PWA</b> (Progressive Web App): mesmo código, comportamento de app
            nativo, instalação direta pelo navegador, ícone na tela inicial, abertura em janela
            própria e sincronização em nuvem entre seus dispositivos.
          </p>
        </Card>
      </main>
    </div>
  );
}