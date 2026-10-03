import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import {
  buildContaAzulCsv, parseLegacyXls, splitInParts, validateImportedClients,
  CONTA_AZUL_LIMIT, type ContaAzulClient, type ValidationSummary,
} from "@/lib/conta-azul";

const MAX_BYTES = 25 * 1024 * 1024;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ContaAzulTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clients, setClients] = useState<ContaAzulClient[] | null>(null);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);

  const pick = (f?: File | null) => {
    setError(""); setClients(null); setSummary(null);
    if (!f) return;
    if (!/\.(xlsx?|XLSX?)$/.test(f.name)) return setError("Selecione um arquivo .xls ou .xlsx.");
    if (f.size > MAX_BYTES) return setError("Arquivo muito grande (máx. 25 MB).");
    setFile(f);
  };

  const process = async () => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const list = await parseLegacyXls(file);
      setClients(list);
      setSummary(validateImportedClients(list));
      setFile(null); // descarta o arquivo original da memória
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ler este arquivo. Verifique se ele é um XLS/XLSX válido.");
    } finally {
      setBusy(false);
    }
  };

  const tooMany = !!clients && clients.length > CONTA_AZUL_LIMIT;
  const parts = clients ? splitInParts(clients) : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Importar clientes para Conta Azul</h2>
        <p className="text-muted-foreground mt-1">
          Envie seu arquivo XLS de clientes e gere automaticamente uma planilha CSV pronta para importar na Conta Azul Pro.
        </p>
        <p className="text-xs text-muted-foreground mt-1">Processado só no seu navegador — nada é enviado ou salvo.</p>
      </div>

      <Card
        className={`p-8 border-2 border-dashed text-center cursor-pointer transition-colors ${drag ? "border-primary bg-primary/5" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
      >
        <input
          ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden" data-testid="conta-azul-input"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }}
        />
        <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium">Arraste o arquivo XLS aqui ou clique para selecionar</p>
        <p className="text-sm text-muted-foreground">Aceita .xls e .xlsx</p>
      </Card>

      {file && (
        <Card className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
            <span className="truncate">{file.name}</span>
          </div>
          <Button onClick={process} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando arquivo...</> : "Processar arquivo"}
          </Button>
        </Card>
      )}

      {error && (
        <Card className="p-4 border-destructive text-destructive flex gap-2 items-start">
          <AlertTriangle className="w-5 h-5 shrink-0" />{error}
        </Card>
      )}

      {clients && summary && (
        <>
          <div className="flex items-center gap-2 text-primary font-medium">
            <CheckCircle2 className="w-5 h-5" /> Arquivo processado com sucesso!
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["Clientes encontrados", summary.total],
              ["Com telefone", summary.comTelefone],
              ["Sem telefone", summary.semTelefone],
              ["Com CPF/CNPJ", summary.comDoc],
              ["Sem CPF/CNPJ", summary.semDoc],
            ].map(([l, v]) => (
              <Card key={l} className="p-4">
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="text-2xl font-bold">{v}</div>
              </Card>
            ))}
          </div>

          {(summary.semTelefone > 0 || summary.semDoc > 0 || summary.issues.length > 0 || tooMany) && (
            <Card className="p-4 space-y-1 text-sm">
              {tooMany && (
                <p className="text-destructive font-medium">
                  O arquivo possui mais de 500 clientes. Divida o arquivo em partes de até 500 clientes para importar na Conta Azul.
                </p>
              )}
              {summary.semTelefone > 0 && <p>{summary.semTelefone} clientes não possuem telefone preenchido no arquivo original.</p>}
              {summary.semDoc > 0 && <p>{summary.semDoc} clientes sem CPF/CNPJ.</p>}
              {summary.issues.map((i) => <p key={i.campo}>Atenção: {i.campo} — {i.quantidade}</p>)}
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            {tooMany ? (
              parts.map((p, i) => (
                <Button key={i} size="lg" onClick={() => download(buildContaAzulCsv(p), `clientes_conta_azul_parte${i + 1}.csv`)}>
                  <Download className="w-4 h-4 mr-2" />Baixar Parte {i + 1} ({p.length})
                </Button>
              ))
            ) : (
              <Button size="lg" onClick={() => download(buildContaAzulCsv(clients), "clientes_conta_azul.csv")}>
                <Download className="w-5 h-5 mr-2" />Baixar CSV para Conta Azul
              </Button>
            )}
          </div>

          <Card className="overflow-auto max-h-[500px]">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {["Nome", "CPF/CNPJ", "E-mail", "Telefone", "CEP", "Endereço", "Número", "Bairro", "Cidade", "Estado"].map((h) => (
                    <th key={h} className="text-left p-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.slice(0, 100).map((c, i) => (
                  <tr key={i} className="border-t">
                    {[c.nome, c.cpfCnpj, c.email, c.telefone, c.cep, c.endereco, c.numero, c.bairro, c.cidade, c.estado].map((v, j) => (
                      <td key={j} className="p-2 whitespace-nowrap">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {clients.length > 100 && (
              <p className="p-2 text-xs text-muted-foreground">Mostrando 100 de {clients.length}. O CSV contém todos.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
