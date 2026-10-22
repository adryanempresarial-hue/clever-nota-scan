import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ImportDates } from "@/lib/import-dates";

export function ImportDateFilter({ value, onChange }: { value: ImportDates; onChange: (value: ImportDates) => void }) {
  return <div className="flex flex-wrap items-center gap-2">
    <span className="text-xs text-muted-foreground">Data de importação</span>
    {(["from", "to"] as const).map(key => <Popover key={key}>
      <PopoverTrigger asChild><Button variant="outline" size="sm" aria-label={key === "from" ? "Data inicial de importação" : "Data final de importação"}>
        <CalendarDays className="mr-2 size-4" />{value[key] ? format(value[key], "dd/MM/yyyy") : key === "from" ? "De" : "Até"}
      </Button></PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0 pointer-events-auto"><Calendar mode="single" locale={ptBR} selected={value[key]} onSelect={date => onChange({ ...value, [key]: date })} captionLayout="dropdown" className="pointer-events-auto" /></PopoverContent>
    </Popover>)}
    {(value.from || value.to) && <Button variant="ghost" size="icon" title="Limpar datas" aria-label="Limpar datas" onClick={() => onChange({})}><X className="size-4" /></Button>}
    {value.from && value.to && value.from > value.to && <span role="alert" className="text-xs text-destructive">A data inicial deve ser anterior à final.</span>}
  </div>;
}