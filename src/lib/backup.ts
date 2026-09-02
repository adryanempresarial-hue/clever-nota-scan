import type { CloudRecord } from "@/lib/nota-sync";

const KEY = "nota:backup:v1";

export type BackupPayload = {
  savedAt: string;
  count: number;
  records: CloudRecord[];
};

/** Lê o backup local (pasta interna do app). */
export function readBackup(): BackupPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BackupPayload;
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Grava o backup local dos cadastros com a data do salvamento. */
export function writeBackup(records: CloudRecord[]): BackupPayload | null {
  if (typeof window === "undefined") return null;
  const payload: BackupPayload = {
    savedAt: new Date().toISOString(),
    count: records.length,
    records,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function clearBackup() {
  if (typeof window !== "undefined") localStorage.removeItem(KEY);
}

/** Baixa o backup como arquivo .json para guardar fora do dispositivo. */
export function downloadBackup(payload: BackupPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nota-backup-${payload.savedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
