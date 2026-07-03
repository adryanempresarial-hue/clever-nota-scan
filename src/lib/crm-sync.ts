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
  const userIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const id = userIdRef.current ?? (await uid());
    userIdRef.current = id;
    if (!id) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("crm_records" as never)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setRecords((data as unknown as Record<string, unknown>[]).map(mapRow));
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

  return { records, loading, syncing, addOne, removeOne, clearAll, refresh };
}