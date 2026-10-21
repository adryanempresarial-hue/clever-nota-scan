import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Pencil } from "lucide-react";

export function FiscalEditableValue({ value, label, original, previous, editingOverride = false, onChange }: { value: string; label: string; original: boolean; previous?: string; editingOverride?: boolean; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  return <div className="min-w-0 space-y-1">
    <div className="flex min-w-0 items-center gap-1">
      {(editing || editingOverride) && !original ? <Input autoFocus={!editingOverride} className="min-w-0 flex-1" aria-label={label} value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditing(false); }} /> : <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{value || "—"}</span>}
      {!original && <Button size="icon" variant="ghost" className="size-7 shrink-0" title={editing ? "Concluir edição" : `Editar ${label}`} aria-label={editing ? `Concluir edição ${label}` : `Editar ${label}`} onClick={() => setEditing(v => !v)}>{editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}</Button>}
    </div>
    {previous !== undefined && previous !== value && <span className="block break-words text-xs text-muted-foreground">Corrigido · original: {previous || "vazio"}</span>}
  </div>;
}