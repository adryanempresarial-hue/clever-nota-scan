/** Reorders presentation only; source records and other groups stay untouched. */
export function prioritizePeriod<T extends { label: string }>(groups: readonly T[], selected: string): T[] {
  if (!selected) return [...groups];
  return [...groups.filter(group => group.label === selected), ...groups.filter(group => group.label !== selected)];
}