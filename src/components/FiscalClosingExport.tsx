import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { buildClosingWorkbook, closingEntries, selectedClosingRows } from "@/lib/fiscal-closing-export";
import { loadAllFiscalRuns } from "@/lib/fiscal-reader-store";
import type { FiscalRun } from "@/lib/fiscal-reader-store";
import { displayCents } from "@/lib/fiscal-reader";
import type { PaymentRow } from "@/lib/fiscal-reader";
import { downloadBlob } from "@/lib/fiscal-reader-export";

type Props = {
  disabled: boolean;
  current?: { id: string; rows: PaymentRow[] };
  onSaveFile: (blob: Blob, name: string, kind: "pdf" | "xlsx", count: number) => Promise<void>;
};

export function FiscalClosingExport({ disabled, current, onSaveFile }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<FiscalRun[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  useEffect(() => {
    setDate(localStorage.getItem("fiscal-closing-date") || new Date().toISOString().slice(0, 10));
  }, []);
  const load = async () => {
    setLoading(true); setError(""); setRuns([]); setSelected(new Set()); setSearch("");
    try {
      const all = await loadAllFiscalRuns();
      setRuns(all); setSelected(new Set(all.map(run => run.id)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os documentos."); }
    finally { setLoading(false); }
  };
  const rows = selectedClosingRows(runs, selected, current);
  const entries = closingEntries(rows);
  const omitted = rows.filter(row => !row.excluded).length - entries.length;
  const visible = runs.filter(run => run.file_name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const toggle = (id: string, checked: boolean) => setSelected(previous => {
    const next = new Set(previous);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const download = async () => {
    if (!date || !selected.size || !entries.length || entries.length > 1000) return;
    setExporting(true);
    try {
      const blob = await buildClosingWorkbook(rows, date);
      const name = `Fechamento_Verdes_Vales_${date}.xlsx`;
      downloadBlob(blob, name);
      try { await onSaveFile(blob, name, "xlsx", entries.length); toast.success("Fechamento exportado e salvo em Arquivos Gerados"); }
      catch { toast.warning("Fechamento baixado, mas a cópia na conta não pôde ser salva."); }
      setOpen(false);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Falha ao exportar o fechamento."); }
    finally { setExporting(false); }
  };
  return <>
    <Button variant="outline" disabled={disabled || exporting} onClick={() => { setOpen(true); void load(); }}><FileSpreadsheet className="mr-2 size-4" />Baixar Fechamento Verdes Vales</Button>
    <Dialog open={open} onOpenChange={value => { if (!exporting) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Fechamento Verdes Vales</DialogTitle><DialogDescription>Documentos para o relatório</DialogDescription></DialogHeader>
        <label className="space-y-1 text-sm"><span>Data do fechamento</span><Input type="date" aria-label="Data do fechamento" value={date} onChange={event => { setDate(event.target.value); localStorage.setItem("fiscal-closing-date", event.target.value); }} /></label>
        {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Carregando todos os documentos</p> : error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Tentar novamente</Button></div> : <>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{selected.size} de {runs.length} documentos marcados</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setSelected(new Set(runs.map(run => run.id)))} disabled={!runs.length}>Marcar todos</Button><Button size="sm" variant="outline" onClick={() => setSelected(new Set())} disabled={!selected.size}>Desmarcar todos</Button></div></div>
          <Input aria-label="Pesquisar arquivos do fechamento" placeholder="Pesquisar arquivo" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="max-h-72 overflow-y-auto rounded-md border">
            {visible.map(run => {
              const recordRows = current?.id === run.id ? current.rows : run.corrected_rows;
              const count = closingEntries(recordRows).length;
              return <label key={run.id} className="flex cursor-pointer items-start gap-3 border-b p-3 last:border-b-0">
                <Checkbox className="mt-1 shrink-0" aria-label={`Incluir ${run.file_name}`} checked={selected.has(run.id)} onCheckedChange={checked => toggle(run.id, checked === true)} />
                <span className="min-w-0 text-sm"><span className="block break-all font-medium">{run.file_name}</span><span className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString("pt-BR")} · {count} lançamentos · {run.status === "confirmed" ? "Confirmado" : "Pendente de conferência"}</span></span>
              </label>;
            })}
            {!visible.length && <p className="p-4 text-sm text-muted-foreground">{runs.length ? "Nenhum arquivo encontrado." : "Nenhum documento importado."}</p>}
          </div>
          <div className="space-y-1 text-sm"><p>{entries.length} lançamentos · Total: R$ {displayCents(entries.reduce((total, entry) => total + entry.cents, 0))}</p>{omitted > 0 && <p role="alert" className="text-destructive">{omitted} linhas sem valor legível não entrarão no relatório.</p>}{entries.length > 1000 && <p role="alert" className="text-destructive">O modelo aceita até 1.000 lançamentos. Desmarque arquivos para baixar.</p>}</div>
        </>}
        <DialogFooter className="gap-2"><Button variant="outline" disabled={exporting} onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={loading || !!error || exporting || !date || !selected.size || !entries.length || entries.length > 1000} onClick={() => void download()}>{exporting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileSpreadsheet className="mr-2 size-4" />}Baixar relatório selecionado</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}