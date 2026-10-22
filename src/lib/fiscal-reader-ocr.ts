export async function localOcr(image: File | HTMLCanvasElement, progress?: (message: string) => void) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por", 1, {
    workerPath: new URL("/ocr/worker.min.js", window.location.origin).href,
    corePath: new URL("/ocr/", window.location.origin).href,
    langPath: new URL("/ocr/", window.location.origin).href,
    logger: event => progress?.(`Reconhecendo texto: ${Math.round(event.progress * 100)}%`),
  });
  try { const { data } = await worker.recognize(image); return data.text; }
  finally { await worker.terminate(); }
}
export async function localPdfPages(file: File, progress?: (message: string) => void) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loading.promise;
  const pages: { text: string; page: string; ocr: boolean }[] = [];
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      progress?.(`Lendo página ${index}/${pdf.numPages}`);
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is import("pdfjs-dist/types/src/display/api").TextItem => "str" in item);
      const groups: { y: number; items: typeof items }[] = [];
      for (const item of items) {
        const y = item.transform[5];
        let group = groups.find(g => Math.abs(g.y - y) < 3);
        if (!group) { group = { y, items: [] }; groups.push(group); }
        group.items.push(item);
      }
      let text = groups.sort((a, b) => b.y - a.y).map(g => g.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join("\t")).join("\n");
      const ocr = text.trim().length < 20;
      if (ocr) {
        const canvas = document.createElement("canvas");
        const viewport = page.getViewport({ scale: 2 });
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Não foi possível abrir a página para leitura.");
        await page.render({ canvasContext: context, canvas, viewport }).promise;
        text = await localOcr(canvas, progress);
        canvas.width = 0; canvas.height = 0;
      }
      pages.push({ text, page: String(index), ocr });
      page.cleanup();
    }
    return pages;
  } finally { await loading.destroy(); }
}