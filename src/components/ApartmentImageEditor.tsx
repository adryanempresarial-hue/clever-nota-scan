import { useEffect, useRef, useState } from "react";
import { RotateCw, Check, X, Crop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { canvasBlob, fileCanvas, fullCorners, rectifyImage, type Corners } from "@/lib/apartment-reader-image";
import { toast } from "sonner";

export function ApartmentImageEditor({ file, onDone, onClose }: { file: File | null; onDone: (file: File) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const original = useRef<HTMLCanvasElement | null>(null);
  const [corners, setCorners] = useState<Corners>(fullCorners);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (file) void fileCanvas(file).then(canvas => {
      if (cancelled) return;
      original.current = canvas; setCorners(fullCorners());
      const display = canvasRef.current; if (display) { display.width = canvas.width; display.height = canvas.height; display.getContext("2d")?.drawImage(canvas, 0, 0); }
    }).catch(e => toast.error(e.message));
    return () => { cancelled = true; };
  }, [file]);
  const rotate = () => {
    const source = original.current, display = canvasRef.current; if (!source || !display) return;
    const rotated = document.createElement("canvas"); rotated.width = source.height; rotated.height = source.width;
    const context = rotated.getContext("2d"); if (!context) return;
    context.translate(rotated.width, 0); context.rotate(Math.PI / 2); context.drawImage(source, 0, 0);
    original.current = rotated; display.width = rotated.width; display.height = rotated.height; display.getContext("2d")?.drawImage(rotated, 0, 0); setCorners(fullCorners());
  };
  const apply = async () => {
    if (!original.current || !file) return;
    setBusy(true);
    try { const corrected = rectifyImage(original.current, corners); const blob = await canvasBlob(corrected); onDone(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Recorte inválido"); }
    finally { setBusy(false); }
  };
  return <Dialog open={!!file} onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Conferir página</DialogTitle><DialogDescription>{file?.name}</DialogDescription></DialogHeader>
    <div className="relative mx-auto w-full max-w-sm"><canvas ref={canvasRef} className="h-auto max-h-[40dvh] w-full object-contain" /></div>
    <div className="flex gap-2"><Button variant="outline" onClick={rotate}><RotateCw className="mr-2 size-4" />Girar 90°</Button><Button variant="outline" onClick={() => setCorners(fullCorners())}><Crop className="mr-2 size-4" />Imagem inteira</Button></div>
    <div className="grid grid-cols-2 gap-3">{["Superior esquerdo", "Superior direito", "Inferior direito", "Inferior esquerdo"].map((label, i) => <fieldset key={label} className="min-w-0 space-y-1"><legend className="text-xs font-medium">{label}</legend>{(["x", "y"] as const).map(axis => <label key={axis} className="flex items-center gap-2 text-xs"><span>{axis.toUpperCase()} %</span><Input type="number" min={0} max={100} step={1} aria-label={`${label} ${axis}`} value={Math.round(corners[i][axis] * 100)} onChange={e => setCorners(previous => previous.map((p, n) => n === i ? { ...p, [axis]: Math.max(0, Math.min(100, Number(e.target.value))) / 100 } : p) as Corners)} /></label>)}</fieldset>)}</div>
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}><X className="mr-2 size-4" />Cancelar</Button><Button disabled={busy} onClick={() => void apply()}><Check className="mr-2 size-4" />Aplicar recorte</Button></div>
  </DialogContent></Dialog>;
}