import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CrmField = { rotulo: string; valor: string };
export type CrmRecord = {
  id: string;
  created_at: string;
  arquivo: string;
  documento_tipo: string | null;
  campos: CrmField[];
};

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function mapRow(r: Record<string, unknown>): CrmRecord {
  const campos = Array.isArray(r.campos) ? (r.campos as CrmField[]) : [];
  return {
    id: r.id as string,
    created_at: r.created_at as string,
    arquivo: (r.arquivo as string) ?? "",
    documento_tipo: (r.documento_tipo as string) ?? null,
    campos,
  };
}

export function useCrmRecords() {
  const [records, setRecords] = useState<CrmRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [total, setTotal] = useState(0);
  const userIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const id = userIdRef.current ?? (await uid());
    userIdRef.current = id;
    if (!id) {
      setLoading(false);
      return;
    }
    // PostgREST caps rows per request (~1000). Paginate to load everything
    // and always update the counter from an exact server-side count.
    const PAGE = 1000;
    const all: Record<string, unknown>[] = [];
    let from = 0;
    let count: number | null = null;
    // First page also asks for exact count
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const q = supabase
        .from("crm_records" as never)
        .select("*", from === 0 ? { count: "exact" } : {})
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      const { data, error, count: c } = await q;
      if (error || !data) break;
      if (from === 0 && typeof c === "number") count = c;
      all.push(...(data as unknown as Record<string, unknown>[]));
      if (data.length < PAGE) break;
      from += PAGE;
      if (from > 1_000_000) break;
    }
    setRecords(all.map(mapRow));
    setTotal(count ?? all.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("crm_records_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_records" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const addOne = useCallback(
    async (rec: { arquivo: string; documento_tipo?: string | null; campos: CrmField[] }) => {
      const id = userIdRef.current ?? (await uid());
      if (!id) return;
      setSyncing(true);
      try {
        const { error } = await supabase.from("crm_records" as never).insert({
          user_id: id,
          arquivo: rec.arquivo,
          documento_tipo: rec.documento_tipo ?? null,
          campos: rec.campos,
        } as never);
        if (error) throw error;
        await refresh();
      } finally {
        setSyncing(false);
      }
    },
    [refresh],
  );

  const removeOne = useCallback(async (recordId: string) => {
    setSyncing(true);
    try {
      await supabase.from("crm_records" as never).delete().eq("id", recordId);
      setRecords((prev) => prev.filter((r) => r.id !== recordId));
    } finally {
      setSyncing(false);
    }
  }, []);

  const clearAll = useCallback(async () => {
    const id = userIdRef.current ?? (await uid());
    if (!id) return;
    setSyncing(true);
    try {
      await supabase.from("crm_records" as never).delete().eq("user_id", id);
      setRecords([]);
    } finally {
      setSyncing(false);
    }
  }, []);

  const upsertOne = useCallback(
    async (rec: {
      arquivo: string;
      documento_tipo?: string | null;
      campos: CrmField[];
    }): Promise<{ merged: boolean; added: number }> => {
      const id = userIdRef.current ?? (await uid());
      if (!id) return { merged: false, added: 0 };
      setSyncing(true);
      try {
        // procura registro existente com o mesmo nome de arquivo
        const { data: existing } = await supabase
          .from("crm_records" as never)
          .select("*")
          .eq("user_id", id)
          .eq("arquivo", rec.arquivo)
          .limit(1);
        const row = (existing as unknown as Record<string, unknown>[] | null)?.[0];
        if (row) {
          const prev = mapRow(row);
          const map = new Map<string, string>();
          for (const c of prev.campos) {
            const key = c.rotulo.trim().toLowerCase();
            if (key) map.set(key, c.valor);
          }
          let added = 0;
          for (const c of rec.campos) {
            const key = c.rotulo.trim().toLowerCase();
            if (!key) continue;
            const cur = map.get(key) ?? "";
            // adiciona quando novo, ou substitui quando o novo é mais completo
            if (!cur || (c.valor && c.valor.length > cur.length)) {
              if (!map.has(key)) added++;
              map.set(key, c.valor || cur);
            }
          }
          // preserva a ordem original e acrescenta novos rótulos no fim
          const seen = new Set<string>();
          const mergedCampos: CrmField[] = [];
          for (const c of prev.campos) {
            const key = c.rotulo.trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            mergedCampos.push({ rotulo: c.rotulo, valor: map.get(key) ?? c.valor });
          }
          for (const c of rec.campos) {
            const key = c.rotulo.trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            mergedCampos.push({ rotulo: c.rotulo, valor: map.get(key) ?? c.valor });
          }
          await supabase
            .from("crm_records" as never)
            .update({
              documento_tipo: rec.documento_tipo ?? prev.documento_tipo,
              campos: mergedCampos,
            } as never)
            .eq("id", prev.id);
          await refresh();
          return { merged: true, added };
        }
        const { error } = await supabase.from("crm_records" as never).insert({
          user_id: id,
          arquivo: rec.arquivo,
          documento_tipo: rec.documento_tipo ?? null,
          campos: rec.campos,
        } as never);
        if (error) throw error;
        await refresh();
        return { merged: false, added: rec.campos.length };
      } finally {
        setSyncing(false);
      }
    },
    [refresh],
  );

  return { records, total, loading, syncing, addOne, upsertOne, removeOne, clearAll, refresh };
}