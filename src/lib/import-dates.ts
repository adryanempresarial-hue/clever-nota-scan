export type ImportDates = { from?: Date; to?: Date };
export function importDateBounds(range: ImportDates) {
  const start = range.from ? new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()) : undefined;
  const end = range.to ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1) : undefined;
  return { start: start?.toISOString(), end: end?.toISOString() };
}
export function matchesImportDate(value: string | undefined, range: ImportDates) {
  if (!range.from && !range.to) return true;
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  const { start, end } = importDateBounds(range);
  return (!start || time >= new Date(start).getTime()) && (!end || time < new Date(end).getTime());
}