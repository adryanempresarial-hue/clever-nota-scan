import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { PaymentRow, FiscalTotal } from "./fiscal-reader";
import { calculateTotals } from "./fiscal-reader";
import { importDateBounds, type ImportDates } from "./import-dates";
export type FiscalRun = { id: string; file_name: string; file_hash: string; storage_path: string | null; extracted_rows: PaymentRow[]; corrected_rows: PaymentRow[]; warnings: string[]; totals: FiscalTotal[]; status: string; created_at: string; updated_at: string };
export const asRun = (value: unknown) => value as FiscalRun;
export async function loadFiscalRuns(search: string, page: number, dates: ImportDates = {}) {
  // JSON is searched in the database, not only in the visible page.
  let query = supabase.from("fiscal_document_runs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * 25, page * 25 + 24);
  if (search.trim()) query = query.ilike("search_text", `%${search.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`);
  const { start, end } = importDateBounds(dates);
  if (start) query = query.gte("created_at", start);
  if (end) query = query.lt("created_at", end);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { runs: (data ?? []).map(asRun), count: count ?? 0 };
}
// Read the entire account history, independent of the search and visible page.
export async function loadAllFiscalRuns() {
  const runs: FiscalRun[] = [];
  const size = 250;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await supabase.from("fiscal_document_runs").select("*").order("created_at", { ascending: false }).order("id").range(offset, offset + size - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []).map(asRun);
    runs.push(...batch);
    if (batch.length < size) return runs;
  }
}
export async function hashDocument(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export async function findFiscalRun(hash: string) {
  const { data, error } = await supabase.from("fiscal_document_runs").select("*").eq("file_hash", hash).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? asRun(data) : null;
}
const searchText = (name: string, rows: PaymentRow[]) => `${name} ${rows.map(r => [...Object.values(r).filter(v => typeof v === "string"), r.cpf.replace(/\D/g, "")].join(" ")).join(" ")}`;
export async function saveNewFiscalRun(file: File, hash: string, rows: PaymentRow[], warnings: string[]) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Entre na conta para salvar o processamento.");
  const path = `${auth.user.id}/fiscal/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  const { error: uploadError } = await supabase.storage.from("nota-files").upload(path, file);
  const allWarnings = uploadError ? [...warnings, "O original não foi armazenado: " + uploadError.message] : warnings;
  const { data, error } = await supabase.from("fiscal_document_runs").insert({ user_id: auth.user.id, file_hash: hash, file_name: file.name, storage_path: uploadError ? null : path, extracted_rows: rows as unknown as Json, corrected_rows: rows as unknown as Json, warnings: allWarnings, totals: calculateTotals(rows) as unknown as Json, search_text: searchText(file.name, rows) }).select("*").single();
  if (error) {
    if (!uploadError) await supabase.storage.from("nota-files").remove([path]);
    if (error.code === "23505") { const existing = await findFiscalRun(hash); if (existing) return existing; }
    throw new Error(error.message);
  }
  return asRun(data);
}
export async function saveFiscalReview(run: FiscalRun, rows: PaymentRow[], confirmed: boolean) {
  const { data, error } = await supabase.from("fiscal_document_runs").update({ corrected_rows: rows as unknown as Json, totals: calculateTotals(rows) as unknown as Json, search_text: searchText(run.file_name, rows), status: confirmed ? "confirmed" : "pending", updated_at: new Date().toISOString() }).eq("id", run.id).select("*").single();
  if (error) throw new Error(error.message);
  return asRun(data);
}
export async function originalFiscalFile(run: FiscalRun) {
  if (!run.storage_path) throw new Error("Original indisponível.");
  const { data, error } = await supabase.storage.from("nota-files").download(run.storage_path);
  if (error) throw new Error(error.message);
  return data;
}
export async function deleteFiscalRun(id: string) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Entre na conta para apagar o documento.");
  const { data: run, error: readError } = await supabase.from("fiscal_document_runs").select("id, storage_path").eq("id", id).eq("user_id", auth.user.id).single();
  if (readError || !run) throw new Error("Documento não encontrado na sua conta.");
  if (run.storage_path) {
    const { error } = await supabase.storage.from("nota-files").remove([run.storage_path]);
    if (error) throw new Error("Não foi possível apagar o arquivo original. Tente novamente.");
  }
  const { data: deleted, error } = await supabase.from("fiscal_document_runs").delete().eq("id", id).eq("user_id", auth.user.id).select("id");
  if (error || !deleted?.length) throw new Error("Não foi possível remover o histórico. Tente novamente.");
}