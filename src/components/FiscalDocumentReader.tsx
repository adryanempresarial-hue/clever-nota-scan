import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Copy, Download, FileSearch, FileSpreadsheet, FileText, Loader2, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { FiscalResultsTable } from "./FiscalResultsTable";
import { buildClosingWorkbook } from "@/lib/fiscal-closing-export";
import { readFiscalDocument } from "@/lib/fiscal-reader.functions";
import { calculateTotals, canConfirm, displayCents, documentTotalCents, fiscalSplit, paymentFields, possibleDuplicates } from "@/lib/fiscal-reader";
import type { PaymentRow } from "@/lib/fiscal-reader";
import { prepareDocument, READER_ACCEPT, unpackDocuments } from "@/lib/fiscal-reader-files";
import { deleteFiscalRun, findFiscalRun, hashDocument, loadFiscalRuns, originalFiscalFile, saveFiscalReview, saveNewFiscalRun } from "@/lib/fiscal-reader-store";
import type { FiscalRun } from "@/lib/fiscal-reader-store";
import { copyFiscalText, downloadBlob, exportFiscalRun, fiscalCopyText } from "@/lib/fiscal-reader-export";

type Props = { onSaveFile: (blob: Blob, name: string, kind: "pdf" | "xlsx", count: number) => Promise<void> };
export function FiscalDocumentReader({ onSaveFile }: Props) {
  const extract = useServerFn(readFiscalDocument);
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [active, setActive] = useState<FiscalRun | null>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [duplicateReview, setDuplicateReview] = useState(false);
  const [warningReview, setWarningReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowPage, setRowPage] = useState(0);
  const [resultSearch, setResultSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FiscalRun | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setPage(0); }, 300); return () => clearTimeout(timer); }, [search]);
  const history = useQuery({ queryKey: ["fiscal-runs", debounced, page], queryFn: () => loadFiscalRuns(debounced, page) });
  const duplicates = useMemo(() => possibleDuplicates(rows), [rows]);
  const totals = useMemo(() => calculateTotals(rows), [rows]);
  const [closingDate, setClosingDate] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => { const saved = localStorage.getItem("fiscal-closing-date"); if (saved) setClosingDate(saved); }, []);
  const exportClosing = async () => {
    if (!closingDate) { toast.error("Informe a data do fechamento."); return; }
    try {
      const blob = await buildClosingWorkbook(rows, closingDate);
      const name = `Fechamento_Verdes_Vales_${closingDate}.xlsx`;
      downloadBlob(blob, name);
      await onSaveFile(blob, name, "xlsx", rows.length).catch(() => undefined);
      toast.success("Fechamento exportado");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao exportar"); }
  };
  const split = useMemo(() => fiscalSplit(documentTotalCents(rows)), [rows]);
  const isConfirmed = active?.status === "confirmed" && JSON.stringify(rows) === JSON.stringify(active.corrected_rows);
  const copyTotal = (cents: number) => void copyFiscalText(displayCents(cents)).then(() => toast.success("Copiado")).catch(error => toast.error(error.message));
  const removeDocument = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFiscalRun(deleteTarget.id);
      if (active?.id === deleteTarget.id) { setActive(null); setRows([]); }
      setDeleteTarget(null);
      if (history.data?.runs.length === 1 && page > 0) setPage(p => p - 1);
      await history.refetch();
      toast.success("Documento importado apagado");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível apagar o documento."); }
    finally { setDeleting(false); }
  };
  const open = (run: FiscalRun) => {
    setActive(run); setRows(run.corrected_rows); setShowOriginal(false); setRowPage(0); setResultSearch("");
    setDuplicateReview(run.status === "confirmed"); setWarningReview(run.status === "confirmed");
  };
  const runImport = async (selected: File[]) => {
    setBusy(true); setNotices([]);
    const issues: string[] = [];
    try {
      for (const container of selected) {
        if (container.size > 15 * 1024 * 1024) { issues.push(`${container.name}: limite de 15 MB por arquivo. Divida o documento.`); continue; }
        let unpacked: Awaited<ReturnType<typeof unpackDocuments>>;
        try { unpacked = await unpackDocuments(container); } catch (error) { issues.push(`${container.name}: ${error instanceof Error ? error.message : "Arquivo compactado ilegível"}`); continue; }
        issues.push(...unpacked.warnings);
        for (const [index, file] of unpacked.files.entries()) {
          setProgress(`Lendo ${index + 1}/${unpacked.files.length}: ${file.name}`);
          if (!file.size) { issues.push(`${file.name}: arquivo vazio.`); continue; }
          if (file.size > 15 * 1024 * 1024) { issues.push(`${file.name}: limite de 15 MB.`); continue; }
          const hash = await hashDocument(file);
          const existing = await findFiscalRun(hash);
          if (existing) { open(existing); issues.push(`${file.name}: já processado; histórico existente aberto, sem duplicar dados.`); continue; }
          let prepared: Awaited<ReturnType<typeof prepareDocument>>;
          try { prepared = await prepareDocument(file); } catch (error) { issues.push(`${file.name}: ${error instanceof Error ? error.message : "Não foi possível ler"}`); continue; }
          let extractedRows: PaymentRow[];
          let warnings: string[] = prepared.warnings ?? [];
          extractedRows = prepared.rows ?? [];
          if (prepared.text || prepared.base64) {
            // A terminal AI error stops the whole import; no retries or substitute models.
            const output = await extract({ data: { name: file.name, text: prepared.text, mimeType: prepared.mimeType as "application/pdf" | "image/png" | "image/jpeg" | undefined, base64: prepared.base64 } });
            warnings = [...warnings, ...output.warnings];
            extractedRows = [...extractedRows, ...output.rows.map(r => ({ ...r, source: file.name, reviewed: false }))];
          }
          if (!extractedRows.length) warnings.push("Nenhum pagamento identificado. Confira o documento original.");
          const run = await saveNewFiscalRun(file, hash, extractedRows, warnings);
          open(run); await history.refetch();
        }
      }
      setProgress("Processamento concluído");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao processar documentos.";
      issues.push(message); toast.error(message); setProgress("Processamento interrompido");
    } finally { setNotices(issues); setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  };
  const save = async (confirm: boolean) => {
    if (!active) return;
    if (confirm && (!canConfirm(rows, duplicateReview) || (active.warnings.length > 0 && !warningReview))) { toast.error("Confira as linhas, os valores e as pendências antes de confirmar."); return; }
    setSaving(true);
    try { const updated = await saveFiscalReview(active, rows, confirm); open(updated); await history.refetch(); toast.success(confirm ? "Conferência confirmada e salva" : "Correções salvas; conferência pendente"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao salvar"); }
    finally { setSaving(false); }
  };
  const exportResult = async (kind: "xlsx" | "pdf") => {
    if (!active) return;
    setSaving(true);
    try {
      const exportRun = { ...active, status: active.status === "confirmed" && JSON.stringify(rows) === JSON.stringify(active.corrected_rows) ? "confirmed" : "pending" };
      const blob = await exportFiscalRun(exportRun, rows.filter(r => !r.excluded), kind);
      const name = `leitor_fiscal_${active.file_name.replace(/[^\w.-]/g, "_")}.${kind}`;
      downloadBlob(blob, name);
      try { await onSaveFile(blob, name, kind, rows.length); toast.success("Exportado e salvo em Arquivos Gerados"); }
      catch { toast.warning("Arquivo baixado, mas a cópia na conta não pôde ser salva."); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao exportar"); }
    finally { setSaving(false); }
  };
  const update = (index: number, field: typeof paymentFields[number], value: string) => {
    setRows(previous => previous.map((r, i) => i === index ? { ...r, [field]: value, reviewed: false } : r));
    setDuplicateReview(false);
  };
  const updatePayments = (index: number, payments: { brand: string; amount: string }[]) => {
    setRows(previous => previous.map((r, i) => i === index ? { ...r, payments, brand: "", amount: "", reviewed: false } : r));
    setDuplicateReview(false);
  };
  const displayedRows = showOriginal ? active?.extracted_rows ?? [] : rows;
  const filtered = displayedRows.map((r, index) => ({ r, index })).filter(({ r }) => showOriginal || !r.excluded).filter(({ r }) => {
    const needle = resultSearch.toLocaleLowerCase("pt-BR");
    return !needle || [...paymentFields.map(f => r[f] ?? ""), ...(r.payments ?? []).flatMap(p => [p.brand, p.amount]), r.source, r.cpf.replace(/\D/g, "")].some(v => v.toLocaleLowerCase("pt-BR").includes(needle));
  });
  return (
    <section className="space-y-5 border-t pt-6" aria-label="Leitor Inteligente de Documentos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold"><FileSearch className="size-5 text-primary" />Leitor Inteligente de Documentos</h2>
        <input ref={fileInput} type="file" accept={READER_ACCEPT} multiple className="hidden" aria-label="Documentos do leitor inteligente" onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) void runImport(files); }} />
        <Button disabled={busy} onClick={() => fileInput.current?.click()}><Upload className="mr-2 size-4" />Importar documentos</Button>
      </div>
      {(busy || progress) && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{busy && <Loader2 className="size-4 animate-spin" />}<span className="break-all">{progress}</span></div>}
      {notices.length > 0 && <ul role="alert" className="space-y-1 border-l-2 border-destructive pl-3 text-sm">{notices.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <div className="flex items-center gap-2"><Input aria-label="Pesquisar processamentos" placeholder="Pesquisar por hóspede, CPF, UH ou arquivo" value={search} onChange={e => setSearch(e.target.value)} /><Button variant="outline" size="icon" aria-label="Atualizar histórico" title="Atualizar histórico" disabled={busy} onClick={() => void history.refetch()}><RefreshCw className="size-4" /></Button></div>
      <h3 className="text-sm font-semibold">Histórico de processamentos · {history.data?.count ?? 0}</h3>
      {history.isPending ? <div className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Carregando histórico</div> : history.error ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar o histórico: {history.error.message}</p> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm"><thead className="bg-muted text-left"><tr>{["Documento", "Data / hora", "Pagamentos", "Conferência", ""].map((h, i) => <th key={i} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody>
            {history.data.runs.map(run => <tr key={run.id} className="border-t"><td className="max-w-64 break-words p-3">{run.file_name}</td><td className="whitespace-nowrap p-3">{new Date(run.created_at).toLocaleString("pt-BR")}</td><td className="p-3">{run.corrected_rows.length}</td><td className="p-3">{run.status === "confirmed" ? "Confirmado" : "Pendente"}</td><td className="p-3"><div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => open(run)}>Detalhes</Button><Button variant="ghost" size="icon" className="text-destructive" disabled={busy || saving || deleting} title="Apagar documento importado" aria-label={`Apagar ${run.file_name}`} onClick={() => setDeleteTarget(run)}><Trash2 className="size-4" /></Button></div></td></tr>)}
            {!history.data.runs.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhum processamento encontrado.</td></tr>}
          </tbody></table>
        </div>
      )}
      <div className="flex items-center justify-end gap-3 text-sm"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button><span>Página {page + 1}</span><Button size="sm" variant="outline" disabled={(page + 1) * 25 >= (history.data?.count ?? 0)} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>
      {active && <div className="space-y-4 border-t pt-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-all font-semibold">{active.file_name}</h3><p className="text-xs text-muted-foreground">{active.status === "confirmed" ? "Confirmado" : "Pendente de conferência"} · salvo em {new Date(active.updated_at).toLocaleString("pt-BR")}</p></div><Button variant="ghost" size="icon" title="Fechar detalhes" aria-label="Fechar detalhes" onClick={() => setActive(null)}><X className="size-4" /></Button></div>
        <div className="flex flex-wrap gap-2">
          <Button variant={showOriginal ? "outline" : "default"} size="sm" onClick={() => { setShowOriginal(false); setRowPage(0); }}>Dados em revisão</Button>
          <Button variant={showOriginal ? "default" : "outline"} size="sm" onClick={() => { setShowOriginal(true); setRowPage(0); }}>Dados extraídos originais</Button>
          {active.storage_path && <Button variant="outline" size="sm" onClick={() => void originalFiscalFile(active).then(blob => downloadBlob(blob, active.file_name)).catch(error => toast.error(error.message))}><Download className="mr-2 size-4" />Original</Button>}
          <Button variant="outline" size="sm" onClick={() => void copyFiscalText(fiscalCopyText(displayedRows.filter(r => showOriginal || !r.excluded))).then(() => toast.success("Copiado")).catch(error => toast.error(error.message))}><Copy className="mr-2 size-4" />Copiar tudo</Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => void exportResult("xlsx")}><FileSpreadsheet className="mr-2 size-4" />Excel</Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => void exportResult("pdf")}><FileText className="mr-2 size-4" />PDF</Button>
          <Button variant="outline" size="icon" className="text-destructive" disabled={busy || saving || deleting} title="Apagar documento importado" aria-label="Apagar documento importado" onClick={() => setDeleteTarget(active)}><Trash2 className="size-4" /></Button>
        </div>
        {active.warnings.length > 0 && <div className="space-y-2 border-l-2 border-destructive pl-3 text-sm"><h4 className="font-medium">Pendências do documento</h4><ul>{active.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><label className="flex items-center gap-2"><Checkbox checked={warningReview} onCheckedChange={v => setWarningReview(v === true)} />Conferi e resolvi as pendências no original</label></div>}
        {duplicates.length > 0 && <div className="space-y-2 text-sm text-destructive"><p>{duplicates.length} linhas com possível duplicidade. Mantidas nos totais.</p><label className="flex items-center gap-2"><Checkbox checked={duplicateReview} onCheckedChange={v => setDuplicateReview(v === true)} />Conferi: são pagamentos distintos</label></div>}
        <Input aria-label="Pesquisar resultados do documento" placeholder="Pesquisar neste documento" value={resultSearch} onChange={e => { setResultSearch(e.target.value); setRowPage(0); }} />
        <FiscalResultsTable entries={filtered.slice(rowPage * 25, rowPage * 25 + 25)} originals={active.extracted_rows} original={showOriginal} duplicates={duplicates} update={update} updatePayments={updatePayments} review={(index, checked) => setRows(previous => previous.map((r, i) => i === index ? { ...r, reviewed: checked } : r))} copy={r => void copyFiscalText(fiscalCopyText([r])).then(() => toast.success("Copiado")).catch(error => toast.error(error.message))} copyTotal={copyTotal} copyValue={v => void copyFiscalText(v).then(() => toast.success("Copiado")).catch(error => toast.error(error.message))} remove={index => { setRows(previous => previous.map((r, i) => i === index ? { ...r, excluded: true } : r)); toast.success("Linha excluída. Clique em Salvar correções para manter.", { action: { label: "Desfazer", onClick: () => setRows(previous => previous.map((r, i) => i === index ? { ...r, excluded: false } : r)) } }); }} />
        <div className="space-y-2 rounded-md border p-3"><h4 className="text-sm font-semibold">Cálculo fiscal do documento · total de créditos + pagamentos</h4><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[["Total calculado", split.total], ["Serviço (30%)", split.servico], ["Alimentação (30% do restante)", split.alimentacao], ["Bebidas frias (restante)", split.bebidas]].map(([label, cents]) => <div key={label as string} className="flex items-center justify-between rounded-md bg-muted/50 p-2 text-sm"><div><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">R$ {displayCents(cents as number)}</p></div><Button variant="ghost" size="icon" title="Copiar valor" aria-label={`Copiar ${label}`} onClick={() => copyTotal(cents as number)}><Copy className="size-4" /></Button></div>)}</div><p className="text-xs text-muted-foreground">Linhas excluídas e valores ilegíveis não entram na soma.</p><div className="flex flex-wrap items-end gap-2 border-t pt-3"><label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">Data do fechamento</span><Input type="date" aria-label="Data do fechamento" className="w-44" value={closingDate} onChange={e => { setClosingDate(e.target.value); localStorage.setItem("fiscal-closing-date", e.target.value); }} /></label><Button variant="outline" disabled={saving} onClick={() => void exportClosing()}><FileSpreadsheet className="mr-2 size-4" />Baixar Fechamento Verdes Vales</Button></div></div>
        <div className="flex items-center justify-end gap-3 text-sm"><span>{filtered.length} linhas</span><Button size="sm" variant="outline" disabled={rowPage === 0} onClick={() => setRowPage(p => p - 1)}>Linhas anteriores</Button><Button size="sm" variant="outline" disabled={(rowPage + 1) * 25 >= filtered.length} onClick={() => setRowPage(p => p + 1)}>Próximas linhas</Button></div>
        <h4 className="text-sm font-semibold">Totais por UH e hóspede · valores legíveis{!isConfirmed && " · provisórios"}</h4>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left"><tr>{["UH", "Hóspede", "Pagamentos", "Créditos"].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead><tbody>{totals.map((t, i) => <tr key={i} className="border-t"><td className="p-2">{t.uh || "—"}</td><td className="p-2">{t.guest || "—"}</td><td className="p-2 tabular-nums"><div className="flex items-center gap-2"><span>{displayCents(t.paymentsCents)}</span><Button variant="ghost" size="icon" title="Copiar total de pagamentos" aria-label={`Copiar total de pagamentos ${i + 1}`} onClick={() => copyTotal(t.paymentsCents)}><Copy className="size-4" /></Button></div></td><td className="p-2 tabular-nums"><div className="flex items-center gap-2"><span>{displayCents(t.creditsCents)}</span><Button variant="ghost" size="icon" title="Copiar total de créditos" aria-label={`Copiar total de créditos ${i + 1}`} onClick={() => copyTotal(t.creditsCents)}><Copy className="size-4" /></Button></div></td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap gap-2"><Button disabled={saving || showOriginal} variant="outline" onClick={() => void save(false)}><Save className="mr-2 size-4" />Salvar correções</Button><Button disabled={saving || showOriginal || !canConfirm(rows, duplicateReview) || (active.warnings.length > 0 && !warningReview)} onClick={() => void save(true)}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}Confirmar conferência</Button></div>
      </div>}
      <AlertDialog open={deleteTarget !== null} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Apagar documento importado?</AlertDialogTitle><AlertDialogDescription className="break-words">O documento {deleteTarget?.file_name}, seu arquivo original e os dados deste processamento serão apagados da sua conta. Esta ação não pode ser desfeita. As exportações em Arquivos Gerados serão mantidas.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancelar</Button><Button variant="destructive" disabled={deleting} onClick={() => void removeDocument()}>{deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}Apagar documento</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}