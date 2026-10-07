import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, Copy, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

type Props = {
  onSaveFile: (blob: Blob, name: string, kind: "pdf" | "xlsx", count: number) => Promise<void>;
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function parseMoney(raw: string): number {
  const s = String(raw ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyWithToast(text: string, label = "Copiado") {
  const ok = await copyText(text);
  if (ok) toast.success(label);
  else toast.error("Não foi possível copiar — selecione e copie manualmente");
}

export function FiscalTab({ onSaveFile }: Props) {
  const [valorRaw, setValorRaw] = useState("");
  const [pctServico, setPctServico] = useState("30");
  const [pctAlimentacao, setPctAlimentacao] = useState("30");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const calc = useMemo(() => {
    const total = parseMoney(valorRaw);
    const ps = (parseMoney(pctServico) || 0) / 100;
    const pa = (parseMoney(pctAlimentacao) || 0) / 100;
    const servico = total * ps;
    const base = total - servico;
    const alimentacao = base * pa;
    const bebidas = base * (1 - pa);
    const soma = servico + alimentacao + bebidas;
    return { total, servico, alimentacao, bebidas, soma, ok: Math.abs(soma - total) < 0.005 };
  }, [valorRaw, pctServico, pctAlimentacao]);

  const importSheet = async (file: File) => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let found: number | null = null;
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: true });
        for (let r = 0; r < rows.length && found === null; r++) {
          const row = rows[r] || [];
          for (let c = 0; c < row.length; c++) {
            const cell = String(row[c] ?? "").toUpperCase();
            if (cell.includes("VALOR DA CONTA") || cell.includes("PREENCHA AQUI")) {
              const candidates: any[] = [];
              for (let rr = r; rr <= r + 3 && rr < rows.length; rr++) {
                const rowN = rows[rr] || [];
                for (let cc = 0; cc < rowN.length; cc++) {
                  if (rr === r && cc <= c) continue;
                  candidates.push(rowN[cc]);
                }
              }
              const num = candidates
                .map((v) => (typeof v === "number" ? v : parseMoney(String(v ?? ""))))
                .find((v) => v > 0);
              if (num) {
                found = num;
                break;
              }
            }
          }
        }
        if (found !== null) break;
      }
      if (found === null) {
        toast.error("Não encontrei o valor da conta na planilha");
        return;
      }
      setValorRaw(found.toFixed(2).replace(".", ","));
      toast.success(`Valor importado: ${brl(found)}`);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível ler a planilha");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportXlsx = async () => {
    if (!calc.total) {
      toast.error("Informe o valor da conta");
      return;
    }
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([
        ["CÁLCULO NOTA FISCAL - VENDA"],
        [],
        ["Valor da conta", calc.total],
        [],
        ["Item", "Valor"],
        [`Serviço (${pctServico}%)`, calc.servico],
        [`Alimentação (${pctAlimentacao}% do restante)`, calc.alimentacao],
        ["Bebidas frias (restante)", calc.bebidas],
        ["TOTAL", calc.soma],
        ["Conferência", calc.ok ? "VERDADEIRO" : "FALSO"],
      ]);
      ws["!cols"] = [{ wch: 34 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Cálculo Fiscal");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const name = `calculo_fiscal_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      await onSaveFile(blob, name, "xlsx", 1);
      toast.success(`Excel gerado: ${name}`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar Excel");
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    { label: `Serviço (${pctServico}%)`, value: calc.servico },
    { label: `Alimentação (${pctAlimentacao}% do restante)`, value: calc.alimentacao },
    { label: "Bebidas frias (restante)", value: calc.bebidas },
  ];

  const [view, setView] = useState<"geral" | "bebidas">("geral");

  const exportBebidasXlsx = async () => {
    if (!calc.total) {
      toast.error("Informe o valor da conta");
      return;
    }
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([
        ["BEBIDAS FRIAS"],
        [],
        ["Valor da conta", calc.total],
        [`Serviço (${pctServico}%)`, calc.servico],
        ["Base de cálculo (conta - serviço)", calc.total - calc.servico],
        [`Bebidas frias (${100 - (parseMoney(pctAlimentacao) || 0)}% do restante)`, calc.bebidas],
      ]);
      ws["!cols"] = [{ wch: 40 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bebidas Frias");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const name = `bebidas_frias_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      await onSaveFile(blob, name, "xlsx", 1);
      toast.success(`Excel gerado: ${name}`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar Excel");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button
          variant={view === "geral" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("geral")}
        >
          Cálculo geral
        </Button>
        <Button
          variant={view === "bebidas" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("bebidas")}
        >
          Bebidas frias
        </Button>
      </div>

      {view === "bebidas" ? (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold">Bebidas frias</h2>
          <p className="text-sm text-muted-foreground">
            Percentual sobre o restante: {100 - (parseMoney(pctAlimentacao) || 0)}%
          </p>
          <div className="flex items-center justify-between border rounded-lg p-4">
            <span className="text-sm text-muted-foreground">Valor de bebidas frias</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums">{brl(calc.bebidas)}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void copyWithToast(plain(calc.bebidas))}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Button disabled={busy || !calc.total} onClick={exportBebidasXlsx}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Exportar Excel (bebidas frias)
          </Button>
        </Card>
      ) : (
        <>
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Cálculo fiscal da nota</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Valor da conta (R$)</Label>
            <Input
              inputMode="decimal"
              placeholder="130.372,89"
              value={valorRaw}
              onChange={(e) => setValorRaw(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>% Serviço</Label>
            <Input value={pctServico} onChange={(e) => setPctServico(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-2">
            <Label>% Alimentação (do restante)</Label>
            <Input
              value={pctAlimentacao}
              onChange={(e) => setPctAlimentacao(e.target.value)}
              inputMode="decimal"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".ods,.xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importSheet(f);
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" />
            Importar planilha
          </Button>
          <Button disabled={busy || !calc.total} onClick={exportXlsx}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Exportar Excel
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between border-b pb-2 last:border-0">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <div className="flex items-center gap-2">
              <span className="font-medium tabular-nums">{brl(r.value)}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void copyWithToast(plain(r.value))}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2">
          <span className="font-semibold">Total</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{brl(calc.soma)}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void copyWithToast(plain(calc.soma))}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <p className={`text-xs ${calc.ok ? "text-emerald-600" : "text-destructive"}`}>
          Conferência: {calc.ok ? "VERDADEIRO" : "FALSO"}
        </p>
      </Card>
        </>
      )}
    </div>
  );
}
