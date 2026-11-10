import { extractApartmentRows, detectApartmentPeriod, type GreenBand, type OcrWord } from "./apartment-reader";
import { fileCanvas, detectPaperCorners, rectifyImage, enhanceImage } from "./apartment-reader-image";

export function greenBands(image: { data: Uint8ClampedArray; width: number; height: number }): GreenBand[] {
  const { data, width, height } = image; const bands: GreenBand[] = [];
  let current: GreenBand | undefined;
  for (let y = 0; y < height; y++) {
    let first = width, last = 0, count = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (g > 100 && g > r * 1.12 && g > b * 1.25 && g - b > 35) { first = Math.min(first, x); last = x; count++; }
    }
    if (count >= Math.max(8, width * .012)) {
      if (current && y - current.y1 < 6) { current.y1 = y + 1; current.x0 = Math.min(current.x0, first); current.x1 = Math.max(current.x1, last + 1); }
      else { current = { x0: first, x1: last + 1, y0: y, y1: y + 1 }; bands.push(current); }
    }
  }
  return bands.filter(b => b.y1 - b.y0 >= 3);
}

export async function readApartmentDocuments(files: File[], progress: (percent: number, text: string) => void) {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("por", 1, {
    workerPath: new URL("/ocr/worker.min.js", window.location.origin).href,
    corePath: new URL("/ocr/", window.location.origin).href,
    langPath: new URL("/ocr/", window.location.origin).href,
  });
  const rows: ReturnType<typeof extractApartmentRows> = []; const warnings: string[] = []; let pageCount = 0, period = "";
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    for (const [fileIndex, file] of files.entries()) {
      const readPage = async (canvas: HTMLCanvasElement, page: number, count: number) => {
        pageCount++;
        progress((fileIndex + (page - 1) / count) / files.length * 100, `${file.name} · página ${page}/${count}`);
        const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Imagem indisponível.");
        const bands = greenBands(ctx.getImageData(0, 0, canvas.width, canvas.height));
        // Remove marker chroma on the OCR copy only; keep original color geometry as evidence.
        const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
        const c = copy.getContext("2d"); if (!c) throw new Error("Imagem indisponível.");
        c.drawImage(canvas, 0, 0); const pixels = c.getImageData(0, 0, copy.width, copy.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
          pixels.data[i] = gray; pixels.data[i + 1] = gray; pixels.data[i + 2] = gray;
        }
        c.putImageData(pixels, 0, 0);
        const { data } = await worker.recognize(copy, {}, { text: true, blocks: true });
        const words: OcrWord[] = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(p => p.lines.flatMap(l => l.words.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })))));
        const parsed = extractApartmentRows(words, bands, file.name, page);
        if (!parsed.length) parsed.push({ id: `${file.name}:${page}:unreadable`, uh: "", value: "", source: file.name, page, confidence: 0, reviewed: false, reason: "Página sem UH reconhecida: confira e preencha no original" });
        rows.push(...parsed);
        if (!parsed.length) warnings.push(`${file.name} · página ${page}: nenhuma UH identificada; confira a página original.`);
        if (!bands.length) warnings.push(`${file.name} · página ${page}: destaque verde não identificado.`);
        if (!period) period = detectApartmentPeriod(data.text);
        copy.width = 0; canvas.width = 0;
      };
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist"); const url = await import("pdfjs-dist/build/pdf.worker.min.mjs?url"); pdfjs.GlobalWorkerOptions.workerSrc = url.default;
        const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        try {
          const pdf = await task.promise;
          for (let page = 1; page <= pdf.numPages; page++) {
            const p = await pdf.getPage(page); const viewport = p.getViewport({ scale: 2 });
            const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d"); if (!context) throw new Error("Página indisponível.");
            await p.render({ canvas, canvasContext: context, viewport }).promise;
            await readPage(canvas, page, pdf.numPages); p.cleanup();
          }
        } finally { await task.destroy(); }
      } else {
        const image = await fileCanvas(file); const corrected = rectifyImage(image, detectPaperCorners(image));
        enhanceImage(corrected); image.width = 0; await readPage(corrected, 1, 1);
      }
    }
    progress(100, "Leitura concluída"); return { rows, pageCount, warnings, period };
  } finally { await worker.terminate(); }
}