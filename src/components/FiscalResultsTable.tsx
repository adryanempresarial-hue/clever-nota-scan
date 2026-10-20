import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Trash2 } from "lucide-react";
import { fiscalSplit, calculatedRowTotal, displayCents, paymentFields, paymentLabels, readingStatus, resultHeaders, rowDoubts, rowPayments } from "@/lib/fiscal-reader";
import type { PaymentRow } from "@/lib/fiscal-reader";

type Props = {
  entries: { r: PaymentRow; index: number }[]; originals: PaymentRow[]; original: boolean; duplicates: number[];
  update: (index: number, field: typeof paymentFields[number], value: string) => void;
  updatePayments: (index: number, payments: { brand: string; amount: string }[]) => void;
  review: (index: number, checked: boolean) => void;
  copy: (row: PaymentRow) => void; copyTotal: (cents: number) => void; remove: (index: number) => void; copyValue: (value: string) => void;
};
export function FiscalResultsTable({ entries, originals, original, duplicates, update, updatePayments, review, copy, copyTotal, remove, copyValue }: Props) {
  const fieldCell = (r: PaymentRow, index: number, field: typeof paymentFields[number]) => {
    const value = r[field] ?? "";
    const old = originals[index]?.[field] ?? "";
    return original ? <span className="whitespace-pre-wrap">{value || "—"}</span> : <div><Input className="w-full min-w-0" aria-label={`${paymentLabels[paymentFields.indexOf(field)]} linha ${index + 1}`} value={value} onChange={e => update(index, field, e.target.value)} />{old !== value && <span className="text-xs text-muted-foreground">Corrigido · original: {old || "vazio"}</span>}</div>;
  };
  const copyBtn = (value: string, label: string) => <Button size="icon" variant="ghost" className="size-7 shrink-0" disabled={!value} title="Copiar valor" aria-label={label} onClick={() => copyValue(value)}><Copy className="size-3.5" /></Button>;
  return <div className="fiscal-results min-w-0 max-w-full rounded-md border"><table className="w-full table-fixed text-sm" aria-label="Resultados da conferência fiscal">
    <thead className="bg-primary text-primary-foreground text-left"><tr>{[...resultHeaders, "Ações"].map(h => <th key={h} className="border-r border-primary-foreground/20 p-3 font-medium">{h}</th>)}</tr></thead>
    <tbody>{entries.map(({ r, index }) => {
      const payments = rowPayments(r);
      const total = calculatedRowTotal(r);
      return <tr key={index} className="border-t align-top even:bg-muted/50">
        {(["page", "uh", "comp"] as const).map(field => <td key={field} data-label={paymentLabels[paymentFields.indexOf(field)]} className="border-r p-2">{fieldCell(r, index, field)}</td>)}
        <td data-label="Responsável / hóspede" className="border-r p-2"><div className="space-y-2">{fieldCell(r, index, "guest")}<div className="text-xs text-muted-foreground">CPF{fieldCell(r, index, "cpf")}</div><p className="max-w-64 break-all text-xs text-muted-foreground">{r.source}</p></div></td>
        <td data-label="Créditos" className="border-r p-2 tabular-nums"><div className="flex min-w-0 items-start gap-1 [&>div]:min-w-0 [&>div]:flex-1">{fieldCell(r, index, "credit")}{copyBtn(r.credit, `Copiar crédito linha ${index + 1}`)}</div></td>
        <td data-label="Meios de pagamento identificados" className="border-r p-2"><div className="space-y-2">{payments.length ? payments.map((p, j) => <div key={j}>{original ? <span className="flex items-center gap-1 tabular-nums">{p.brand || "Não identificado"}: {p.amount || "Não lido"}{copyBtn(p.amount, `Copiar pagamento ${j + 1} linha ${index + 1}`)}</span> : <div className="flex flex-wrap gap-1"><Input className="min-w-0 flex-1 basis-20" aria-label={`Meio de pagamento ${j + 1} linha ${index + 1}`} value={p.brand} onChange={e => updatePayments(index, payments.map((v, k) => k === j ? { ...v, brand: e.target.value } : v))} /><Input className="min-w-0 flex-1 basis-24" aria-label={`Valor do pagamento ${j + 1} linha ${index + 1}`} value={p.amount} onChange={e => updatePayments(index, payments.map((v, k) => k === j ? { ...v, amount: e.target.value } : v))} />{copyBtn(p.amount, `Copiar pagamento ${j + 1} linha ${index + 1}`)}</div>}</div>) : <span className="text-muted-foreground">Nenhum pagamento identificado</span>}{!original && <Button size="sm" variant="ghost" onClick={() => updatePayments(index, [...payments, { brand: "", amount: "" }])}>Adicionar pagamento</Button>}{!original && JSON.stringify(payments) !== JSON.stringify(rowPayments(originals[index] ?? r)) && <p className="text-xs text-muted-foreground">Corrigido · original: {rowPayments(originals[index] ?? r).map(p => `${p.brand}: ${p.amount}`).join("; ") || "vazio"}</p>}</div></td>
        <td data-label="Total calculado" className="border-r p-2"><div className="flex items-center gap-1 flex-wrap font-semibold tabular-nums"><span>{total === null ? "—" : displayCents(total)}</span><Button size="icon" variant="ghost" disabled={total === null} title="Copiar total calculado" aria-label={`Copiar total calculado linha ${index + 1}`} onClick={() => { if (total !== null) copyTotal(total); }}><Copy className="size-4" /></Button></div>{total !== null && (() => { const sp = fiscalSplit(total); return <div className="mt-1 space-y-1 text-xs">{([["Serviço (30%)", sp.servico], ["Alimentação (30% do restante)", sp.alimentacao], ["Bebidas frias (restante)", sp.bebidas]] as const).map(([label, cents]) => <div key={label} className="flex items-center justify-between gap-1 flex-wrap"><span className="text-muted-foreground">{label}</span><span className="flex shrink-0 items-center tabular-nums">{displayCents(cents)}<Button size="icon" variant="ghost" className="size-7" title={`Copiar ${label}`} aria-label={`Copiar ${label} linha ${index + 1}`} onClick={() => copyTotal(cents)}><Copy className="size-3.5" /></Button></span></div>)}</div>; })()}</td>
        <td data-label="Situação" className="border-r p-2"><p className={r.reviewed ? "font-medium text-primary" : "font-medium text-destructive"}>{readingStatus(r)}</p>{!original && <label className="mt-2 flex items-center gap-2"><Checkbox aria-label={`Conferir linha ${index + 1}`} checked={r.reviewed} onCheckedChange={v => review(index, v === true)} />Conferido</label>}{!r.reviewed && <p className="mt-1 text-xs text-destructive">{rowDoubts(r).join("; ")}</p>}{duplicates.includes(index) && <p className="text-xs text-destructive">Possível duplicidade</p>}</td>
        <td data-label="Ações" className="p-2"><div className="flex gap-1"><Button size="icon" variant="ghost" title="Copiar linha" aria-label={`Copiar linha ${index + 1}`} onClick={() => copy(r)}><Copy className="size-4" /></Button>{!original && <Button size="icon" variant="ghost" className="text-destructive" title="Excluir linha errada" aria-label={`Excluir linha ${index + 1}`} onClick={() => remove(index)}><Trash2 className="size-4" /></Button>}</div></td>
      </tr>;
    })}</tbody></table></div>;
}