/** Collect contact values without shortening or dropping partial source values. */
export function mergeContactEmails(values: string[], preserveUnmatched = true): string {
  return [...new Set(values.flatMap(value => {
    const matches = value.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g);
    return matches ?? (preserveUnmatched && value.trim() ? [value.trim()] : []);
  }).map(value => value.toLowerCase()))].join("; ");
}

function formatSinglePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0055") && [14, 15].includes(digits.length)) digits = digits.slice(4);
  else if (digits.startsWith("55") && [12, 13].includes(digits.length)) digits = digits.slice(2);
  else if (digits.startsWith("0") && [11, 12].includes(digits.length)) digits = digits.slice(1);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return value.trim();
}

export function mergeContactPhones(values: string[]): string {
  const phones = values.flatMap(value => value.split(/\s*[;|\n]\s*|\s+\/\s+/).filter(Boolean)).map(formatSinglePhone);
  return [...new Set(phones)].join("; ");
}