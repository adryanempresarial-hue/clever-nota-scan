import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ApartmentRow } from "./apartment-reader";
export type ApartmentRun = { id: string; title: string; period: string; page_count: number; original_rows: ApartmentRow[]; reviewed_rows: ApartmentRow[]; source_files: { name: string; path: string; hash: string }[]; created_at: string };
export async function listApartmentRuns(page = 0) {
  const { data, error, count } = await supabase.from("apartment_reader_runs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * 20, page * 20 + 19);
  if (error) throw new Error(error.message); return { runs: (data ?? []) as unknown as ApartmentRun[], count: count ?? 0 };
}
export async function saveApartmentRun(input: { id?: string; rows: ApartmentRow[]; originalRows: ApartmentRow[]; period: string; pageCount: number; files: File[] }) {
  const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError || !auth.user) throw new Error("Entre na sua conta para salvar.");
  const payload = { period: input.period, reviewed_rows: input.rows as unknown as Json, updated_at: new Date().toISOString() };
  if (input.id) {
    const { data, error } = await supabase.from("apartment_reader_runs").update(payload).eq("id", input.id).select("*").single();
    if (error) throw new Error(error.message); return data as unknown as ApartmentRun;
  }
  const sources: ApartmentRun["source_files"] = [];
  try {
    for (const file of input.files) {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      const path = `${auth.user.id}/apartment/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("nota-files").upload(path, file); if (error) throw new Error("Não foi possível guardar o documento original: " + error.message);
      sources.push({ name: file.name, path, hash });
    }
    const { data, error } = await supabase.from("apartment_reader_runs").insert({ ...payload, user_id: auth.user.id, title: input.files.map(f => f.name).join("; ") || "Leitura consolidada", page_count: input.pageCount, original_rows: input.originalRows as unknown as Json, source_files: sources as unknown as Json }).select("*").single();
    if (error) throw new Error(error.message); return data as unknown as ApartmentRun;
  } catch (error) { if (sources.length) await supabase.storage.from("nota-files").remove(sources.map(s => s.path)); throw error; }
}
export async function apartmentOriginal(path: string) {
  const { data, error } = await supabase.storage.from("nota-files").download(path); if (error) throw new Error(error.message); return data;
}