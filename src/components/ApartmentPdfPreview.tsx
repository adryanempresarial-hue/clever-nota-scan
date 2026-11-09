import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
export function ApartmentPdfPreview({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1), [count, setCount] = useState(1), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const pdfjs = await import("pdfjs-dist"); const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url"); pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }); cleanup = () => { void task.destroy(); };
      const pdf = await task.promise; if (cancelled) return; setCount(pdf.numPages);
      const p = await pdf.getPage(page); const viewport = p.getViewport({ scale: 1.5 });
      const element = canvas.current; if (!element || cancelled) return;
      element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height);
      const context = element.getContext("2d"); if (!context) return;
      const render = p.render({ canvas: element, canvasContext: context, viewport });
      cleanup = () => { render.cancel(); void task.destroy(); }; await render.promise;
    })().catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; cleanup?.(); };
  }, [blob, page]);
  return <div className="space-y-3">{error && <p role="alert" className="text-destructive">{error}</p>}<canvas ref={canvas} className="mx-auto h-auto w-full max-w-xl border" /><div className="flex items-center justify-center gap-3"><Button variant="outline" size="icon" aria-label="Página anterior do PDF" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="size-4" /></Button><span className="text-sm">{page} / {count}</span><Button variant="outline" size="icon" aria-label="Próxima página do PDF" disabled={page === count} onClick={() => setPage(p => p + 1)}><ChevronRight className="size-4" /></Button></div></div>;
}