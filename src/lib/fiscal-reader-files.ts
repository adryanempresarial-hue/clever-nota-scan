import type { PaymentRow } from "./fiscal-reader";
import { parsePaymentSheet } from "./fiscal-reader";

export const READER_ACCEPT = ".pdf,.xlsx,.xls,.csv,.docx,.jpg,.jpeg,.png,.zip,.rar";
export async function unpackDocuments(file: File): Promise<{ files: File[]; warnings: string[] }> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "rar") return { files: [], warnings: [`${file.name}: RAR não suportado por este leitor. Extraia os documentos ou envie um ZIP.`] };
  if (ext !== "zip") return { files: [file], warnings: [] };
  const { unzipSync } = await import("fflate");
  let size = 0;
  const warnings: string[] = [];
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
    size += entry.originalSize;
    if (size > 50 * 1024 * 1024) throw new Error("ZIP excede 50 MB descompactados. Divida o arquivo.");
    return !entry.name.endsWith("/");
  } });
  const files: File[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (/\.(pdf|xlsx|xls|csv|docx|jpe?g|png)$/i.test(name)) files.push(new File([new Uint8Array(bytes)], `${file.name}/${name}`));
    else warnings.push(`${name}: formato não suportado dentro do ZIP.`);
  }
  return { files, warnings };
}
export async function prepareDocument(file: File): Promise<{ rows?: PaymentRow[]; text?: string; mimeType?: string; base64?: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["xlsx", "xls", "csv"].includes(ext ?? "")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellText: true });
    const all: PaymentRow[] = [];
    const unmatched: string[] = [];
    for (const name of workbook.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
      const rows = parsePaymentSheet(matrix, `${file.name} · ${name}`);
      if (rows) all.push(...rows);
      else if (matrix.length) unmatched.push(`Planilha ${name}:\n${matrix.map(r => r.join("\t")).join("\n")}`);
    }
    if (!unmatched.length) return { rows: all };
    // Mixed worksheets go together to OCR, not silently discarded.
    return { text: workbook.SheetNames.map(name => `Planilha ${name}:\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name], { FS: "\t" })}`).join("\n\n") };
  }
  if (ext === "docx") {
    const { unzipSync, strFromU8 } = await import("fflate");
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const xml = entries["word/document.xml"];
    if (!xml) throw new Error("DOCX sem conteúdo legível.");
    const parsed = new DOMParser().parseFromString(strFromU8(xml), "application/xml");
    const text = Array.from(parsed.getElementsByTagName("w:p")).map(p => Array.from(p.getElementsByTagName("w:t")).map(t => t.textContent).join(" ")).join("\n");
    if (!text.trim()) throw new Error("DOCX sem texto: envie as imagens incorporadas como JPG/PNG ou PDF.");
    return { text };
  }
  const mimeType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ["jpg", "jpeg"].includes(ext ?? "") ? "image/jpeg" : "";
  if (!mimeType) throw new Error(`${file.name}: formato não suportado.`);
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Falha ao ler arquivo")); reader.readAsDataURL(file);
  });
  return { mimeType, base64 };
}