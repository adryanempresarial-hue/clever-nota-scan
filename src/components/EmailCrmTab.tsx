import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AtSign, Copy, FileSpreadsheet, Loader2, Mail, MailSearch, RefreshCw, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { getEmailProviders, scanEmailContacts } from "@/lib/email.functions";

type Contact = {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  cpf: string | null;
  cep: string | null;
  origem: string | null;
  provedor: string | null;
  created_at: string;
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallthrough */ }
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

export function EmailCrmTab() {
  const [providers, setProviders] = useState<{ gmail: boolean; outlook: boolean } | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState("");
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const cancelRef = useRef(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("crm_email_contacts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (!error && data) setContacts(data as unknown as Contact[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    getEmailProviders().then(setProviders).catch(() => setProviders({ gmail: false, outlook: false }));
    refresh();
  }, [refresh]);

  const runScan = async (provider: "gmail" | "outlook") => {
    setScanning(true);
    cancelRef.current = false;
    let token: string | undefined;
    let totalScanned = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    try {
      // loop de páginas até acabar ou o usuário cancelar
      for (;;) {
        if (cancelRef.current) break;
        setScanInfo(`Varrendo... ${totalScanned} e-mails analisados`);
        const r = await scanEmailContacts({
          data: { provider, pageToken: token, maxMessages: 100 },
        });
        totalScanned += r.scanned;
        totalInserted += r.inserted;
        totalUpdated += r.updated;
        if (!r.nextPageToken || r.scanned === 0) break;
        token = r.nextPageToken;
      }
      toast.success(
        `Varredura concluída: ${totalScanned} e-mails analisados, ${totalInserted} contatos novos, ${totalUpdated} atualizados`,
      );
      await refresh();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Falha na varredura de e-mails");
    } finally {
      setScanning(false);
      setScanInfo("");
    }
  };

  const removeOne = async (id: string) => {
    setRemoved((prev) => new Set(prev).add(id));
  };

  const restoreRemoved = () => setRemoved(new Set());

  const deleteOne = async (id: string) => {
    const { error } = await supabase.from("crm_email_contacts").delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível excluir");
      return;
    }
    setContacts((prev) => prev.filter((c) => c.id !== id));
    toast.success("Contato excluído");
  };

  const clearAll = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("crm_email_contacts").delete().eq("user_id", u.user.id);
    if (error) {
      toast.error("Não foi possível limpar");
      return;
    }
    setContacts([]);
    toast.success("Todos os contatos de e-mail foram removidos");
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (removed.has(c.id)) return false;
      if (!q) return true;
      return [c.nome, c.email, c.telefone, c.cpf, c.cep, c.origem]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [contacts, query, removed]);

  const copyAll = async () => {
    const text = visible
      .map((c) =>
        [
          c.nome ? `Nome: ${c.nome}` : "",
          c.email ? `E-mail: ${c.email}` : "",
          c.telefone ? `Telefone: ${c.telefone}` : "",
          c.cpf ? `CPF: ${c.cpf}` : "",
          c.cep ? `CEP: ${c.cep}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n\n");
    if (!text) {
      toast.error("Nada para copiar");
      return;
    }
    const ok = await copyText(text);
    if (ok) toast.success(`${visible.length} contato(s) copiados`);
    else toast.error("Não foi possível copiar");
  };

  type Fmt = "xlsx" | "xls" | "csv" | "ods" | "pdf" | "docx";
  const exportAs = async (fmt: Fmt) => {
    if (!visible.length) {
      toast.error("Nada para exportar");
      return;
    }
    const base = `crm_email_${new Date().toISOString().slice(0, 10)}`;
    const head = ["Nome", "E-mail", "Telefone", "CPF", "CEP", "Origem", "Provedor", "Data"];
    const body = visible.map((c) => [
      c.nome ?? "", c.email ?? "", c.telefone ?? "", c.cpf ?? "", c.cep ?? "",
      c.origem ?? "", c.provedor ?? "", new Date(c.created_at).toLocaleString("pt-BR"),
    ]);
    try {
      if (fmt === "pdf") {
        const { default: jsPDF } = await import("jspdf");
        const autoTable = (await import("jspdf-autotable")).default;
        const doc = new jsPDF({ orientation: "landscape" });
        doc.setFontSize(14);
        doc.text("CRM E-mail — Contatos", 14, 14);
        autoTable(doc, { head: [head.slice(0, 6)], body: body.map((r) => r.slice(0, 6)), startY: 20, styles: { fontSize: 8 } });
        doc.save(`${base}.pdf`);
      } else if (fmt === "docx") {
        const d = await import("docx");
        const mk = (t: string, bold = false) =>
          new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: t, bold, size: 18 })] })] });
        const table = new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: [
            new d.TableRow({ children: head.slice(0, 5).map((h) => mk(h, true)) }),
            ...body.map((r) => new d.TableRow({ children: r.slice(0, 5).map((v) => mk(v)) })),
          ],
        });
        const doc = new d.Document({
          sections: [{ children: [new d.Paragraph({ text: "CRM E-mail — Contatos", heading: d.HeadingLevel.HEADING_1 }), table] }],
        });
        const blob = await d.Packer.toBlob(doc);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${base}.docx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } else {
        const XLSX = await import("xlsx");
        const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Contatos Email");
        XLSX.writeFile(wb, `${base}.${fmt}`, { bookType: fmt === "csv" ? "csv" : fmt });
      }
      toast.success(`Arquivo ${fmt.toUpperCase()} exportado`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao exportar");
    }
  };

  const configured = providers && (providers.gmail || providers.outlook);

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <MailSearch className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">CRM E-mail — extração de contatos</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Varre todo o histórico da sua caixa de e-mail (sem limite de tempo) e extrai contatos:
          nomes, e-mails, telefones, CPF e CEP — de remetentes, destinatários e do conteúdo das mensagens.
          Os contatos ficam salvos aqui, separados do CRM de documentos.
        </p>

        {providers === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando conexões...
          </div>
        ) : !configured ? (
          <div className="rounded-md border border-dashed p-4 space-y-2">
            <p className="text-sm font-medium">Nenhuma conta de e-mail conectada ainda.</p>
            <p className="text-sm text-muted-foreground">
              Para ativar, peça aqui no chat: <strong>"conectar Gmail"</strong> ou{" "}
              <strong>"conectar Outlook"</strong> e autorize a conexão no cartão que aparecer.
              Depois disso, a varredura fica disponível nesta aba para qualquer conta que você conectar.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {providers.gmail && (
              <Button onClick={() => runScan("gmail")} disabled={scanning}>
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Varrear Gmail
              </Button>
            )}
            {providers.outlook && (
              <Button onClick={() => runScan("outlook")} disabled={scanning} variant={providers.gmail ? "outline" : "default"}>
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Varrear Outlook
              </Button>
            )}
            {scanning && (
              <Button variant="ghost" onClick={() => { cancelRef.current = true; }}>
                <X className="h-4 w-4" /> Parar
              </Button>
            )}
            {scanInfo && <span className="text-sm text-muted-foreground">{scanInfo}</span>}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por nome, e-mail, telefone, CPF..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <Badge variant="secondary">{visible.length} contato(s)</Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy className="h-4 w-4" /> Copiar tudo
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <FileSpreadsheet className="h-4 w-4" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportAs("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("xls")}>Excel 97-2003 (.xls)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("csv")}>CSV (.csv)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("ods")}>OpenOffice (.ods)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("pdf")}>PDF (.pdf)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("docx")}>Word (.docx)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {removed.size > 0 && (
              <Button variant="ghost" size="sm" onClick={restoreRemoved}>
                Restaurar removidos ({removed.size})
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {contacts.length > 0 && (
              <Button variant="destructive" size="sm" onClick={clearAll}>
                <Trash2 className="h-4 w-4" /> Limpar tudo
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando contatos...
          </div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            <AtSign className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhum contato extraído ainda. Conecte uma conta e rode a varredura.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>CEP</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="w-[90px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.slice(0, 500).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-[180px] truncate">{c.nome || "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{c.email || "—"}</TableCell>
                    <TableCell>{c.telefone || "—"}</TableCell>
                    <TableCell>{c.cpf || "—"}</TableCell>
                    <TableCell>{c.cep || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {c.origem || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remover da lista (não exclui)"
                          onClick={() => removeOne(c.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Excluir definitivamente"
                          onClick={() => deleteOne(c.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {visible.length > 500 && (
              <p className="text-xs text-muted-foreground p-2">
                Mostrando 500 de {visible.length} — use a busca ou exporte para ver todos.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
