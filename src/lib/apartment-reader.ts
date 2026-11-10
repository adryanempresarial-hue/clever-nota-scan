import { displayCents, moneyCents } from "./fiscal-reader";

export type ApartmentRow = { id: string; uh: string; value: string; source: string; page: number; confidence: number; reason: string; reviewed: boolean; excluded?: boolean };
export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type GreenBand = { x0: number; y0: number; x1: number; y1: number };
export const apartmentKey = (uh: string) => uh.trim().replace(/^UH\s*/i, "").replace(/^0+(?=\d)/, "");
export const validUh = (uh: string) => /^\d{1,6}$/.test(apartmentKey(uh));
const monetaryTokens = (text: string) => text.match(/(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\b/g) ?? [];
const overlaps = (a: GreenBand, b: GreenBand) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Color evidence is required: nearby card, credit and daily values are never substitutes. */
export function extractApartmentRows(words: OcrWord[], bands: GreenBand[], source: string, page: number): ApartmentRow[] {
  const lines: { y: number; words: OcrWord[] }[] = [];
  for (const word of words) {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    let line = lines.find(l => Math.abs(l.y - cy) < Math.max(8, (word.bbox.y1 - word.bbox.y0) * .55));
    if (!line) { line = { y: cy, words: [] }; lines.push(line); }
    line.words.push(word);
  }
  lines.sort((a, b) => a.y - b.y);
  for (const line of lines) line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const anchors = lines.flatMap((line, i) => {
    const text = line.words.map(w => w.text).join(" ");
    return [...text.matchAll(/\bUH\s*[:\-]?\s*(\d{1,6})\b/gi)].map(m => ({ uh: m[1], index: i, confidence: Math.min(...line.words.map(w => w.confidence)) }));
  });
  const multipleColumns = new Set(anchors.map(a => a.index)).size !== anchors.length;
  const rows = anchors.map((anchor, i) => {
    const section = lines.slice(anchor.index, anchors[i + 1]?.index ?? lines.length);
    const candidates = section.flatMap(line => {
      const greenWords = line.words.filter(w => bands.some(b => overlaps(w.bbox, b)));
      const highlighted = greenWords.map(w => w.text).join(" ");
      const label = /TOTAL\s+(?:DE\s+)?DESPESAS/i.test(line.words.map(w => w.text).join(" "));
      // A highlighted value alone is insufficient without the TOTAL DE DESPESAS label.
      return label ? monetaryTokens(highlighted).map(value => ({ value, confidence: Math.min(...line.words.map(w => w.confidence)) })) : [];
    });
    const unique = [...new Map(candidates.map(c => [moneyCents(c.value), c])).values()];
    const one = unique.length === 1 && !multipleColumns ? unique[0] : undefined;
    const confidence = Math.min(one?.confidence ?? 0, anchor.confidence);
    return { id: `${source}:${page}:${i}`, uh: anchor.uh, value: one?.value ?? "", source, page, confidence, reviewed: false,
      reason: multipleColumns ? "UHs em colunas paralelas: confira a associação no original" : !one ? (unique.length > 1 ? "Mais de um total destacado para esta UH" : "Total de despesas em verde não identificado") : confidence < 80 ? "Leitura com baixa confiança" : "" };
  });
  // Keep identified highlighted totals when the UH was unreadable; never silently discard them.
  for (const line of lines.filter((_, index) => !anchors.length || index < anchors[0].index)) {
    if (!/TOTAL\s+(?:DE\s+)?DESPESAS/i.test(line.words.map(w => w.text).join(" "))) continue;
    const values = monetaryTokens(line.words.filter(w => bands.some(b => overlaps(w.bbox, b))).map(w => w.text).join(" "));
    for (const value of values) rows.push({ id: `${source}:${page}:unassigned:${rows.length}`, uh: "", value, source, page, confidence: 0, reviewed: false, reason: "UH não identificada para o total destacado" });
  }
  return rows;
}

export function consolidateApartments(rows: ApartmentRow[]) {
  const groups = new Map<string, ApartmentRow[]>();
  let duplicates = 0;
  for (const row of rows.filter(r => !r.excluded)) {
    const key = validUh(row.uh) ? apartmentKey(row.uh) : `invalid:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const units = [...groups.values()].map(group => {
    const variants: ApartmentRow[] = [];
    for (const row of group) {
      const cents = moneyCents(row.value);
      // Unreadable rows stay visible, not counted as exact duplicates.
      if (cents !== null && variants.some(v => moneyCents(v.value) === cents)) duplicates++;
      else variants.push(row);
    }
    const conflict = new Set(variants.map(v => moneyCents(v.value)).filter(v => v !== null)).size > 1;
    const pending = conflict || variants.some(r => !validUh(r.uh) || moneyCents(r.value) === null || (!r.reviewed && !!r.reason));
    return { uh: group[0].uh, rows: variants, sources: group, conflict, pending };
  }).sort((a, b) => Number(apartmentKey(a.uh)) - Number(apartmentKey(b.uh)));
  return { units, duplicates, pending: units.filter(u => u.pending).length, unique: units.filter(u => validUh(u.uh)).length };
}
export function apartmentExportRows(rows: ApartmentRow[]) {
  const result = consolidateApartments(rows);
  if (!result.units.length || result.pending) throw new Error("Resolva os valores pendentes e as divergências antes de exportar.");
  return result.units.map(u => ["UH" + u.uh.trim().replace(/^UH\s*/i, ""), displayCents(moneyCents(u.rows[0].value) ?? 0)]);
}
export function apartmentFilename(period: string, kind: "pdf" | "xlsx") {
  const safe = period.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `RELACAO_DE_UHS${safe ? "_" + safe : ""}.${kind}`;
}
export function detectApartmentPeriod(text: string) {
  return text.match(/(?:PER[IÍ]ODO|HOSPEDAGEM)\s*:?\s*([^\n]{5,80})/i)?.[1]?.trim() ?? "";
}