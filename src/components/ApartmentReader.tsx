import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, CameraOff, Check, Copy, Download, Eye, FileSpreadsheet, Loader2, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apartmentFilename, consolidateApartments, type ApartmentRow } from "@/lib/apartment-reader";
import { readApartmentDocuments } from "@/lib/apartment-reader-ocr";
import { canvasBlob } from "@/lib/apartment-reader-image";
import { deliverApartmentFile, exportApartments } from "@/lib/apartment-reader-export";
import { apartmentOriginal, listApartmentRuns, saveApartmentRun, type ApartmentRun } from "@/lib/apartment-reader-store";
import { copyFiscalText } from "@/lib/fiscal-reader-export";
import { ApartmentImageEditor } from "./ApartmentImageEditor";
import { ApartmentPdfPreview } from "./ApartmentPdfPreview";

type Props = { onSaveFile: (blob: Blob, name: string, kind: "pdf" | "xlsx", count: number) => Promise<unknown> };
type PageFile = { id: string; file: File; original: File; url: string };
export function ApartmentReader({ onSaveFile }: Props) {
  const [pages, setPages] = useState<PageFile[]>([]), [rows, setRows] = useState<ApartmentRow[]>([]), [originalRows, setOriginalRows] = useState<ApartmentRow[]>([]);
  const [pageCount, setPageCount] = useState(0), [period, setPeriod] = useState(""), [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState("");
  const [active, setActive] = useState<ApartmentRun | null>(null), [historyPage, setHistoryPage] = useState(0);
  const [camera, setCamera] = useState(false), [cameraError, setCameraError] = useState(""), [cameraReady, setCameraReady] = useState(false);
  const stream = useRef<MediaStream | null>(null), video = useRef<HTMLVideoElement>(null), mounted = useRef(true), cameraRequested = useRef(false);
  const input = useRef<HTMLInputElement>(null), captureInput = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<string | null>(null), [editingRow, setEditingRow] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ pdf: Blob; xlsx: Blob } | null>(null), [preview, setPreview] = useState(false), [search, setSearch] = useState("");
  const [rowPage, setRowPage] = useState(0);
  const history = useQuery({ queryKey: ["apartment-reader-history", historyPage], queryFn: () => listApartmentRuns(historyPage) });
  const consolidated = useMemo(() => consolidateApartments(rows), [rows]);
  const shown = consolidated.units.filter(u => !search || u.uh.includes(search.replace(/^UH\s*/i, "")));
  const pagesRef = useRef(pages); useEffect(() => { pagesRef.current = pages; }, [pages]);
  const stopCamera = () => { cameraRequested.current = false; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setCameraReady(false); setCamera(false); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cameraRequested.current = false; stream.current?.getTracks().forEach(t => t.stop()); pagesRef.current.forEach(p => URL.revokeObjectURL(p.url)); }; }, []);
  useEffect(() => {
    if (camera && stream.current && video.current) { video.current.srcObject = stream.current; void video.current.play().then(() => setCameraReady(true)).catch(() => setCameraError("Não foi possível exibir a câmera. Selecione arquivos ou use a câmera nativa.")); }
  }, [camera, cameraReady]);
  useEffect(() => { setGenerated(null); }, [rows, period]);
  const addFiles = (files: File[]) => {
    const valid = files.filter(f => /\.(?:jpe?g|png|webp|pdf)$/i.test(f.name) || /^image\/(?:jpeg|png|webp)$/.test(f.type));
    if (valid.length !== files.length) toast.error("Selecione imagens JPG, PNG, WEBP ou documentos PDF.");
    const nonempty = valid.filter(f => f.size > 0); if (nonempty.length !== valid.length) toast.error("Arquivo vazio não pode ser lido.");
    setPages(old => [...old, ...nonempty.map(file => ({ id: crypto.randomUUID(), file, original: file, url: URL.createObjectURL(file) }))]);
  };
  const openCamera = async () => {
    setCameraError(""); cameraRequested.current = true; setCamera(true);
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("Câmera indisponível neste navegador. Você pode usar a câmera nativa ou selecionar arquivos."); return; }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 2560 } }, audio: false });
      if (!mounted.current || !cameraRequested.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; const element = video.current;
      if (element) { element.srcObject = media; await element.play(); setCameraReady(true); }
    } catch (e) { const denied = (e as DOMException).name === "NotAllowedError"; setCameraError(denied ? "Acesso à câmera negado. Permita a câmera nas configurações do navegador, ou selecione arquivos." : "Não foi possível abrir a câmera. Selecione arquivos ou use a câmera nativa."); }
  };
  const capture = async () => {
    const element = video.current; if (!element?.videoWidth) return;
    try {
      const canvas = document.createElement("canvas"); canvas.width = element.videoWidth; canvas.height = element.videoHeight;
      canvas.getContext("2d")?.drawImage(element, 0, 0); const blob = await canvasBlob(canvas);
      addFiles([new File([blob], `pagina_${Date.now()}.jpg`, { type: "image/jpeg" })]); toast.success("Página fotografada");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao fotografar"); }
  };
  const process = async () => {
    if (!pages.length || busy) return;
    setBusy(true); setWarnings([]); setGenerated(null);
    try {
      const read = await readApartmentDocuments(pages.map(p => p.file), (percent, text) => { setProgress(percent); setStatus(text); });
      const uniqueIds = read.rows.map(r => ({ ...r, id: crypto.randomUUID() }));
      setRows(uniqueIds); setOriginalRows(uniqueIds); setPageCount(read.pageCount); setWarnings(read.warnings); setPeriod(read.period); setActive(null); setRowPage(0);
      if (!uniqueIds.length) toast.warning("Nenhuma UH reconhecida; confira as imagens originais.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha na leitura"); setStatus("Leitura interrompida; as páginas foram mantidas."); }
    finally { setBusy(false); }
  };
  const updateRow = (id: string, patch: Partial<ApartmentRow>) => { setRows(old => old.map(r => r.id === id ? { ...r, ...patch, reviewed: false } : r)); };
  const save = async () => {
    if (!rows.length) return;
    setBusy(true);
    try { const run = await saveApartmentRun({ id: active?.id, rows, originalRows, period, pageCount, files: pages.map(p => p.original) }); setActive(run); await history.refetch(); toast.success("Leitura e documentos originais salvos na sua conta"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar"); } finally { setBusy(false); }
  };
  const openRun = (run: ApartmentRun) => {
    pages.forEach(p => URL.revokeObjectURL(p.url)); setPages([]); setRows(run.reviewed_rows); setOriginalRows(run.original_rows); setPageCount(run.page_count); setPeriod(run.period); setActive(run); setWarnings([]); setSearch(""); setRowPage(0);
  };
  const generate = async () => {
    setBusy(true);
    try {
      const pdf = await exportApartments(rows, period, "pdf"), xlsx = await exportApartments(rows, period, "xlsx");
      setGenerated({ pdf, xlsx }); setPreview(true);
      try { await onSaveFile(pdf, apartmentFilename(period, "pdf"), "pdf", consolidated.unique); await onSaveFile(xlsx, apartmentFilename(period, "xlsx"), "xlsx", consolidated.unique); }
      catch { toast.warning("Arquivos prontos; não foi possível salvar a cópia em Arquivos Gerados."); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao gerar arquivos"); } finally { setBusy(false); }
  };
  const reset = () => {
    pages.forEach(p => URL.revokeObjectURL(p.url)); setPages([]); setRows([]); setOriginalRows([]); setPageCount(0); setPeriod(""); setActive(null); setWarnings([]); setStatus(""); setSearch(""); setRowPage(0);
  };
  return <section aria-label="Leitor de Apartamento" className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Leitor de Apartamento</h2><Button disabled={busy} variant="outline" onClick={reset}><Plus className="mr-2 size-4" />Processar novo documento</Button></div>
    <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" aria-label="Arquivos do Leitor de Apartamento" className="hidden" onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <input ref={captureInput} type="file" accept="image/*" capture="environment" aria-label="Câmera nativa do Leitor de Apartamento" className="hidden" onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <div className="grid gap-3 sm:grid-cols-2"><Button size="lg" className="h-16 text-base" disabled={busy} onClick={() => void openCamera()}><Camera className="mr-3 size-6" />ESCANEAR DOCUMENTO</Button><Button variant="outline" size="lg" className="h-16" disabled={busy} onClick={() => input.current?.click()}><Upload className="mr-2 size-5" />Galeria / Importar PDF</Button></div>
    {pages.length > 0 && <div className="space-y-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{pages.map((p, index) => <div key={p.id} className="min-w-0 rounded-md border p-2">{/\.pdf$/i.test(p.file.name) ? <div className="flex aspect-[3/4] items-center justify-center bg-muted text-sm">PDF</div> : <img src={p.url} alt={`Página ${index + 1}`} className="aspect-[3/4] w-full object-contain bg-muted" />}<p className="mt-2 break-all text-xs">{p.file.name}</p><div className="mt-2 flex justify-between"><Button variant="ghost" size="icon" aria-label={`Editar página ${index + 1}`} title="Visualizar, girar e recortar" disabled={busy || /\.pdf$/i.test(p.file.name)} onClick={() => setEditor(p.id)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" aria-label={`Excluir página ${index + 1}`} title="Excluir página" disabled={busy} onClick={() => { URL.revokeObjectURL(p.url); setPages(old => old.filter(x => x.id !== p.id)); }}><Trash2 className="size-4" /></Button></div></div>)}</div><Button disabled={busy} onClick={() => void process()}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}Processar {pages.length} arquivo(s)</Button></div>}
    {status && <div role="status" className="space-y-2"><Progress value={progress} /><p className="break-all text-sm text-muted-foreground">{status}</p></div>}
    {warnings.length > 0 && <ul role="alert" className="space-y-1 border-l-2 border-destructive pl-3 text-sm">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    {rows.length > 0 && <div className="space-y-4 border-t pt-4">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Apartamentos únicos", consolidated.unique], ["Páginas digitalizadas", pageCount], ["Duplicidades", consolidated.duplicates], ["Pendentes de conferência", consolidated.pending]].map(([label, value]) => <div key={label} className="border-b py-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{value}</dd></div>)}</dl>
      <label className="block space-y-1 text-sm">Período do documento<Input value={period} onChange={e => setPeriod(e.target.value)} placeholder="Período não identificado" /></label>
      <Input aria-label="Pesquisar UH no Leitor de Apartamento" placeholder="Pesquisar UH" value={search} onChange={e => { setSearch(e.target.value); setRowPage(0); }} />
      <div className="rounded-md border"><table className="w-full table-fixed text-sm"><thead className="bg-muted text-left"><tr><th className="w-[35%] p-3">UNIDADE</th><th className="p-3">VALOR</th></tr></thead><tbody>{shown.slice(rowPage * 25, rowPage * 25 + 25).flatMap(unit => unit.rows.map(row => <tr key={row.id} className="border-t align-top"><td className="break-words p-3"><div className="flex flex-wrap items-center gap-1">{editingRow === row.id ? <Input aria-label={`Editar UH ${row.id}`} value={row.uh} onChange={e => updateRow(row.id, { uh: e.target.value })} /> : <strong>UH{row.uh.replace(/^UH\s*/i, "")}</strong>}<Button variant="ghost" size="icon" title="Editar UH e valor" aria-label={`Editar lançamento ${row.uh}`} onClick={() => setEditingRow(editingRow === row.id ? null : row.id)}>{editingRow === row.id ? <Check className="size-4" /> : <Pencil className="size-4" />}</Button></div><p className="mt-1 break-all text-xs text-muted-foreground">{row.source} · página {row.page}</p></td><td className="p-3"><div className="flex flex-wrap items-center gap-2">{editingRow === row.id ? <Input aria-label={`Editar valor ${row.id}`} value={row.value} onChange={e => updateRow(row.id, { value: e.target.value })} /> : <span className="font-semibold tabular-nums">{row.value ? `R$ ${row.value}` : "Não identificado"}</span>}<Button variant="ghost" size="icon" aria-label={`Copiar valor UH${row.uh}`} title="Copiar número" disabled={!row.value} onClick={() => void copyFiscalText(row.value).then(() => toast.success("Copiado")).catch(e => toast.error(e.message))}><Copy className="size-4" /></Button><Button variant="ghost" size="icon" title="Excluir lançamento" aria-label={`Excluir lançamento UH${row.uh}`} onClick={() => { setRows(old => old.map(r => r.id === row.id ? { ...r, excluded: true } : r)); toast.success("Lançamento excluído", { action: { label: "Desfazer", onClick: () => setRows(old => old.map(r => r.id === row.id ? { ...r, excluded: false } : r)) } }); }}><Trash2 className="size-4" /></Button></div>{unit.conflict && <p role="alert" className="text-xs font-medium text-destructive">Divergência: a mesma UH tem valores diferentes.</p>}{unit.pending && <p className="text-xs text-destructive">PENDENTE DE CONFERÊNCIA{row.reason && ` · ${row.reason}`}</p>}<label className="mt-2 flex items-center gap-2 text-xs"><Checkbox checked={row.reviewed} disabled={!row.uh || !row.value} onCheckedChange={checked => setRows(old => old.map(r => r.id === row.id ? { ...r, reviewed: checked === true } : r))} />Conferido no original</label></td></tr>))}</tbody></table></div>
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={rowPage === 0} onClick={() => setRowPage(p => p - 1)}>Anterior</Button><span className="self-center text-sm">{rowPage + 1}</span><Button size="sm" variant="outline" disabled={(rowPage + 1) * 25 >= shown.length} onClick={() => setRowPage(p => p + 1)}>Próxima</Button></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void save()}><Save className="mr-2 size-4" />Salvar histórico</Button><Button disabled={busy || consolidated.pending > 0 || !consolidated.unique} onClick={() => void generate()}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}GERAR PDF CONSOLIDADO</Button></div>
      {generated && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setPreview(true)}><Eye className="mr-2 size-4" />Visualizar PDF</Button><Button onClick={() => void deliverApartmentFile(generated.pdf, apartmentFilename(period, "pdf")).catch(e => toast.error(e.message))}><Download className="mr-2 size-4" />Baixar PDF</Button><Button variant="outline" onClick={() => void deliverApartmentFile(generated.xlsx, apartmentFilename(period, "xlsx")).catch(e => toast.error(e.message))}><FileSpreadsheet className="mr-2 size-4" />Baixar Excel</Button></div>}
      {active && <div className="flex flex-wrap gap-2">{active.source_files.map(s => <Button key={s.path} variant="outline" size="sm" disabled={busy} onClick={() => void apartmentOriginal(s.path).then(blob => deliverApartmentFile(blob, s.name)).catch(e => toast.error(e.message))}><Download className="mr-2 size-4" /><span className="max-w-48 truncate">Original: {s.name}</span></Button>)}</div>}
    </div>}
    <div className="space-y-3 border-t pt-4"><h3 className="font-semibold">Histórico de leituras · {history.data?.count ?? 0}</h3>{history.isPending && <p className="text-sm text-muted-foreground">Carregando histórico…</p>}{history.error && <p role="alert" className="text-sm text-destructive">{history.error.message}</p>}{history.data?.runs.map(run => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-3"><div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{run.period || run.title}</p><p className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString("pt-BR")} · {consolidateApartments(run.reviewed_rows).unique} UHs · {run.page_count} páginas</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => openRun(run)}>Abrir leitura</Button></div>)}<div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={!historyPage} onClick={() => setHistoryPage(p => p - 1)}>Anterior</Button><Button size="sm" variant="outline" disabled={(historyPage + 1) * 20 >= (history.data?.count ?? 0)} onClick={() => setHistoryPage(p => p + 1)}>Próxima</Button></div></div>
    <Dialog open={camera} onOpenChange={open => { if (!open) stopCamera(); }}><DialogContent className="max-h-[94dvh] overflow-y-auto"><DialogHeader><DialogTitle>Escanear documento</DialogTitle><DialogDescription>{pages.length} página(s) adicionada(s)</DialogDescription></DialogHeader><video ref={video} autoPlay muted playsInline className="aspect-[3/4] max-h-[55dvh] w-full rounded-md bg-muted object-contain" />{cameraError && <p role="alert" className="text-sm text-destructive">{cameraError}</p>}<div className="flex flex-wrap gap-2"><Button disabled={!cameraReady} onClick={() => void capture()}><Camera className="mr-2 size-4" />Fotografar página</Button>{cameraError && <Button variant="outline" onClick={() => { stopCamera(); void openCamera(); }}>Tentar novamente</Button>}<Button variant="outline" onClick={() => captureInput.current?.click()}><Camera className="mr-2 size-4" />Câmera nativa</Button><Button variant="outline" onClick={() => input.current?.click()}><Upload className="mr-2 size-4" />Selecionar arquivos</Button><Button variant="outline" onClick={stopCamera}><CameraOff className="mr-2 size-4" />Concluir fotos</Button></div></DialogContent></Dialog>
    <ApartmentImageEditor file={pages.find(p => p.id === editor)?.file ?? null} onClose={() => setEditor(null)} onDone={file => { setPages(old => old.map(p => { if (p.id !== editor) return p; URL.revokeObjectURL(p.url); return { ...p, file, url: URL.createObjectURL(file) }; })); setEditor(null); }} />
    <Dialog open={preview && !!generated} onOpenChange={setPreview}><DialogContent className="max-h-[94dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>PDF consolidado</DialogTitle><DialogDescription>{consolidated.unique} apartamentos únicos</DialogDescription></DialogHeader>{generated && <><ApartmentPdfPreview blob={generated.pdf} /><Button onClick={() => void deliverApartmentFile(generated.pdf, apartmentFilename(period, "pdf"))}><Download className="mr-2 size-4" />Baixar PDF</Button></>}</DialogContent></Dialog>
  </section>;
}