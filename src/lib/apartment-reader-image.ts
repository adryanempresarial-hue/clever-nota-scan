export type Point = { x: number; y: number };
export type Corners = [Point, Point, Point, Point];
export const fullCorners = (): Corners => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export async function fileCanvas(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Não foi possível abrir a imagem.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
  } finally { URL.revokeObjectURL(url); }
}
export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Falha ao preparar imagem.")), "image/jpeg", .95));
}
/** Detect paper on contrasting background; don't crop if the boundary is uncertain. */
export function detectPaperCorners(canvas: HTMLCanvasElement): Corners {
  const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return fullCorners();
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const points: Point[] = [];
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    const i = (y * width + x) * 4;
    if (Math.min(data[i], data[i + 1], data[i + 2]) > 170) points.push({ x: x / width, y: y / height });
  }
  if (points.length < width * height / 64 * .25) return fullCorners();
  const extreme = (score: (p: Point) => number, max: boolean) => points.reduce((a, b) => (max ? score(b) > score(a) : score(b) < score(a)) ? b : a);
  const corners: Corners = [extreme(p => p.x + p.y, false), extreme(p => p.x - p.y, true), extreme(p => p.x + p.y, true), extreme(p => p.x - p.y, false)];
  // If paper fills the image, preserve the full frame, including edge text.
  if (corners[0].x < .03 && corners[0].y < .03 && corners[2].x > .95 && corners[2].y > .95) return fullCorners();
  return corners;
}
function solve(matrix: number[][]) {
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    if (Math.abs(matrix[i][i]) < 1e-10) throw new Error("Ajuste os quatro cantos sem cruzá-los.");
    const divisor = matrix[i][i]; for (let k = i; k < 9; k++) matrix[i][k] /= divisor;
    for (let j = 0; j < 8; j++) if (j !== i) { const factor = matrix[j][i]; for (let k = i; k < 9; k++) matrix[j][k] -= factor * matrix[i][k]; }
  }
  return matrix.map(r => r[8]);
}
/** Projective warp (not a rectangular crop), keeping highlight colors for recognition. */
export function rectifyImage(input: HTMLCanvasElement, corners: Corners) {
  const ctx = input.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Imagem indisponível.");
  const points = corners.map(p => ({ x: p.x * (input.width - 1), y: p.y * (input.height - 1) }));
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.round(Math.max(distance(points[0], points[1]), distance(points[3], points[2])));
  const height = Math.round(Math.max(distance(points[0], points[3]), distance(points[1], points[2])));
  if (width < 50 || height < 50) throw new Error("O recorte é pequeno demais para leitura.");
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix = uv.flatMap(([u, v], i) => {
    const { x, y } = points[i]; return [[u, v, 1, 0, 0, 0, -u * x, -v * x, x], [0, 0, 0, u, v, 1, -u * y, -v * y, y]];
  });
  const h = solve(matrix); const source = ctx.getImageData(0, 0, input.width, input.height);
  const output = document.createElement("canvas"); output.width = width; output.height = height;
  const out = output.getContext("2d", { willReadFrequently: true }); if (!out) throw new Error("Imagem indisponível.");
  const pixels = out.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1), d = h[6] * u + h[7] * v + 1;
    const sx = Math.max(0, Math.min(input.width - 1, (h[0] * u + h[1] * v + h[2]) / d));
    const sy = Math.max(0, Math.min(input.height - 1, (h[3] * u + h[4] * v + h[5]) / d));
    const i = (y * width + x) * 4;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const at = (xx: number, yy: number) => source.data[(Math.min(input.height - 1, yy) * input.width + Math.min(input.width - 1, xx)) * 4 + c];
      pixels.data[i + c] = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
    }
    pixels.data[i + 3] = 255;
  }
  out.putImageData(pixels, 0, 0); return output;
}
export function enhanceImage(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height); const original = new Uint8ClampedArray(image.data);
  for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++) {
    const i = (y * canvas.width + x) * 4;
    // Gentle unsharp + contrast, maintaining green chroma rather than grayscale.
    for (let c = 0; c < 3; c++) {
      const average = (original[i - 4 + c] + original[i + 4 + c] + original[i - canvas.width * 4 + c] + original[i + canvas.width * 4 + c]) / 4;
      image.data[i + c] = Math.max(0, Math.min(255, (original[i + c] + .35 * (original[i + c] - average) - 128) * 1.08 + 140));
    }
  }
  ctx.putImageData(image, 0, 0);
}