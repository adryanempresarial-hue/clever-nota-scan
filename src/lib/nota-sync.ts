import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { NotaRecord } from "@/lib/nota.functions";

const BUCKET = "nota-files";

export type CloudRecord = NotaRecord & { _id?: string; _createdAt?: string };
export type CloudFile = {
  id: string;
  name: string;
  kind: "docx" | "xlsx" | "pdf";
  storage_path: string;
  count: number;
  created_at: string;
};

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Tokens que representam "vazio" e devem sumir dos registros já escaneados. */
const EMPTY_TOKENS = new Set([
  "null", "undefined", "nan", "na", "n/a", "n/d", "#n/a", "#n/d", "#valor!", "#value!",
  "-", "--", "---", "?", ".", "nulo", "vazio", "none", "sem informacao", "seminformacao",
]);
function clean(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s || EMPTY_TOKENS.has(s.toLowerCase())) return null;
  return s;
}

const DB_COLS = [
  "arquivo","dt_alteracao","dt_cadastro","nome","cpf","cnpj","email","telefone","cep",
  "endereco","numero","bairro","cidade","estado","nota_fiscal","data","valor",
] as const;

/** Remove valores tipo "null"/"N/A" das linhas já salvas no banco. */
async function purgeNullTokens(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const patch: Record<string, string | null> = {};
    for (const col of DB_COLS) {
      const cur = row[col];
      if (cur == null) continue;
      const cleaned = clean(cur);
      if (cleaned !== cur) patch[col] = col === "arquivo" ? (cleaned ?? "") : cleaned;
    }
    if (Object.keys(patch).length) {
      await supabase
        .from("nota_records")
        .update(patch as never)
        .eq("id", row.id as string);
    }
  }
}

function mapRow(r: Record<string, unknown>): CloudRecord {
  const c = (v: unknown) => clean(v);
  return {
    _id: r.id as string,
    _createdAt: r.created_at as string,
    _arquivo: c(r.arquivo) ?? "",
    dtAlteracao: c(r.dt_alteracao),
    dtCadastro: c(r.dt_cadastro),
    nome: c(r.nome),
    cpf: c(r.cpf),
    cnpj: c(r.cnpj),
    email: c(r.email),
    telefone: c(r.telefone),
    cep: c(r.cep),
    endereco: c(r.endereco),
    numero: c(r.numero),
    bairro: c(r.bairro),
    cidade: c(r.cidade),
    estado: c(r.estado),
    notaFiscal: c(r.nota_fiscal),
    data: c(r.data),
    valor: c(r.valor),
  };
}

function toInsert(r: NotaRecord, user_id: string) {
  return {
    user_id,
    arquivo: r._arquivo ?? "",
    dt_alteracao: r.dtAlteracao ?? null,
    dt_cadastro: r.dtCadastro ?? null,
    nome: r.nome ?? null,
    cpf: r.cpf ?? null,
    cnpj: r.cnpj ?? null,
    email: r.email ?? null,
    telefone: r.telefone ?? null,
    cep: r.cep ?? null,
    endereco: r.endereco ?? null,
    numero: r.numero ?? null,
    bairro: r.bairro ?? null,
    cidade: r.cidade ?? null,
    estado: r.estado ?? null,
    nota_fiscal: r.notaFiscal ?? null,
    data: r.data ?? null,
    valor: r.valor ?? null,
  };
}

const FIELDS = [
  "dtAlteracao","dtCadastro","nome","cpf","cnpj","email","telefone","cep","endereco","numero",
  "bairro","cidade","estado","notaFiscal","data","valor",
] as const;

const norm = (v?: string | null) =>
  (v ?? "").toString().replace(/\s+/g, " ").trim().toLowerCase();
const digits = (v?: string | null) => (v ?? "").replace(/\D+/g, "");

// duas fichas são "a mesma pessoa/documento" quando batem por um
// identificador forte, ou pelo mesmo nome de arquivo
function isSameEntity(a: CloudRecord, b: NotaRecord) {
  if (digits(a.cpf) && digits(a.cpf) === digits(b.cpf)) return true;
  if (digits(a.cnpj) && digits(a.cnpj) === digits(b.cnpj)) return true;
  if (norm(a.email) && norm(a.email) === norm(b.email)) return true;
  if (digits(a.telefone) && digits(a.telefone) === digits(b.telefone)) return true;
  if (norm(a._arquivo) && norm(a._arquivo) === norm(b._arquivo)) return true;
  if (
    norm(a.nome) &&
    norm(a.nome) === norm(b.nome) &&
    (digits(a.cep) === digits(b.cep) || !digits(a.cep) || !digits(b.cep))
  )
    return true;
  return false;
}

// mantém o valor mais completo de cada campo
function mergeRecords(oldR: CloudRecord, newR: NotaRecord): NotaRecord {
  const out: Record<string, unknown> = { ...oldR };
  for (const f of FIELDS) {
    const cur = (oldR as Record<string, unknown>)[f] as string | null | undefined;
    const nxt = (newR as Record<string, unknown>)[f] as string | null | undefined;
    if (!norm(nxt)) continue;
    if (!norm(cur) || (nxt ?? "").trim().length > (cur ?? "").trim().length) out[f] = nxt;
  }
  out._arquivo = newR._arquivo || oldR._arquivo;
  return out as NotaRecord;
}

function isMoreComplete(oldR: CloudRecord, merged: NotaRecord) {
  return FIELDS.some(
    (f) =>
      norm((merged as Record<string, unknown>)[f] as string) !==
      norm((oldR as Record<string, unknown>)[f] as string),
  );
}

export function useCloudRecords() {
  const [records, setRecords] = useState<CloudRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const purgedRef = useRef(false);

  const refresh = useCallback(async () => {
    const id = userIdRef.current ?? (await uid());
    userIdRef.current = id;
    if (!id) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("nota_records")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setRecords(data.map(mapRow));
    setLoading(false);
    if (!purgedRef.current && !error && data) {
      purgedRef.current = true;
      purgeNullTokens(data as unknown as Record<string, unknown>[]).catch(() => {});
    }
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("nota_records_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "nota_records" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const addMany = useCallback(
    async (recs: NotaRecord[]) => {
      const id = userIdRef.current ?? (await uid());
      if (!id || recs.length === 0) return { inserted: 0, updated: 0, skipped: 0 };
      setSyncing(true);
      try {
        const { data: existingRows } = await supabase
          .from("nota_records")
          .select("*")
          .eq("user_id", id);
        const pool: CloudRecord[] = (existingRows ?? []).map(mapRow);

        const toCreate: NotaRecord[] = [];
        let updated = 0;
        let skipped = 0;

        for (const rec of recs) {
          const match = pool.find((p) => isSameEntity(p, rec));
          if (!match) {
            toCreate.push(rec);
            pool.push({ ...(rec as CloudRecord) });
            continue;
          }
          const merged = mergeRecords(match, rec);
          if (!isMoreComplete(match, merged)) {
            skipped++; // duplicado idêntico: ignora
            continue;
          }
          const { user_id: _u, ...patch } = toInsert(merged, id);
          await supabase.from("nota_records").update(patch).eq("id", match._id!);
          Object.assign(match, merged);
          updated++;
        }

        if (toCreate.length) {
          const { error } = await supabase
            .from("nota_records")
            .insert(toCreate.map((r) => toInsert(r, id)));
          if (error) throw error;
        }
        await refresh();
        return { inserted: toCreate.length, updated, skipped };
      } finally {
        setSyncing(false);
      }
    },
    [refresh],
  );

  const addOne = useCallback(
    async (r: NotaRecord) => addMany([r]),
    [addMany],
  );

  const removeOne = useCallback(async (recordId?: string) => {
    if (!recordId) return;
    setSyncing(true);
    try {
      await supabase.from("nota_records").delete().eq("id", recordId);
      setRecords((prev) => prev.filter((r) => r._id !== recordId));
    } finally {
      setSyncing(false);
    }
  }, []);

  const clearAll = useCallback(async () => {
    const id = userIdRef.current ?? (await uid());
    if (!id) return;
    setSyncing(true);
    try {
      await supabase.from("nota_records").delete().eq("user_id", id);
      setRecords([]);
    } finally {
      setSyncing(false);
    }
  }, []);

  return { records, loading, syncing, addMany, addOne, removeOne, clearAll, refresh };
}

export function useCloudFiles() {
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const userIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const id = userIdRef.current ?? (await uid());
    userIdRef.current = id;
    if (!id) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("nota_files")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setFiles(data as CloudFile[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("nota_files_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "nota_files" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const saveFile = useCallback(
    async (blob: Blob, name: string, kind: "docx" | "xlsx" | "pdf", count: number) => {
      const id = userIdRef.current ?? (await uid());
      if (!id) throw new Error("Sem sessão");
      setSyncing(true);
      try {
        const path = `${id}/${crypto.randomUUID()}-${name}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, blob, { contentType: blob.type || undefined });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase
          .from("nota_files")
          .insert({ user_id: id, name, kind, storage_path: path, count });
        if (insErr) throw insErr;
        await refresh();
      } finally {
        setSyncing(false);
      }
    },
    [refresh],
  );

  const downloadFile = useCallback(async (f: CloudFile) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(f.storage_path);
    if (error || !data) throw error ?? new Error("Falha no download");
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const removeFile = useCallback(async (f: CloudFile) => {
    setSyncing(true);
    try {
      await supabase.storage.from(BUCKET).remove([f.storage_path]);
      await supabase.from("nota_files").delete().eq("id", f.id);
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    } finally {
      setSyncing(false);
    }
  }, []);

  return { files, loading, syncing, saveFile, downloadFile, removeFile, refresh };
}

export async function signOut() {
  await supabase.auth.signOut();
}