import { useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Save,
  Search,
  ShieldCheck,
  Download,
  RotateCcw,
  Loader2,
  HardDrive,
  Mail,
  Phone,
  MapPin,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { CloudRecord } from "@/lib/nota-sync";
import type { NotaRecord } from "@/lib/nota.functions";
import {
  cleanCell,
  formatCep,
  formatPhone,
  isValidPhone,
  maskPhoneInput,
  titleCase,
} from "@/lib/record-format";
import { readBackup, writeBackup, downloadBackup, type BackupPayload } from "@/lib/backup";

type Patch = {
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  cep?: string | null;
  endereco?: string | null;
};

type Props = {
  records: CloudRecord[];
  onUpdate: (id: string, patch: Patch) => Promise<void>;
  onRestore: (recs: NotaRecord[]) => Promise<unknown>;
};

const norm = (v?: string | null) => (v ?? "").toString().trim();

/** Valores já normalizados de uma ficha (varredura). */
function sweepPatch(r: CloudRecord): Patch | null {
  const patch: Patch = {};
  const nome = cleanCell(r.nome) ? titleCase(cleanCell(r.nome)) : null;
  const email = cleanCell(r.email) ? cleanCell(r.email).toLowerCase() : null;
  const telRaw = cleanCell(r.telefone);
  const tel = telRaw ? formatPhone(telRaw) : "";
  const telefone = tel && isValidPhone(tel) ? tel : telRaw ? null : null;
  const cepRaw = cleanCell(r.cep);
  const cep = cepRaw ? formatCep(cepRaw) : null;
  const endereco = cleanCell(r.endereco) || null;

  if (nome !== (r.nome ?? null)) patch.nome = nome;
  if (email !== (r.email ?? null)) patch.email = email;
  if (telefone !== (r.telefone ?? null)) patch.telefone = telefone;
  if (cep !== (r.cep ?? null)) patch.cep = cep;
  if (endereco !== (r.endereco ?? null)) patch.endereco = endereco;
  return Object.keys(patch).length ? patch : null;
}

export default function ContactsTab({ records, onUpdate, onRestore }: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<(Patch & { id: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [backup, setBackup] = useState<BackupPayload | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [sweep, setSweep] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    setBackup(readBackup());
  }, []);

  // Backup automático na pasta do app sempre que os cadastros mudarem
  useEffect(() => {
    if (records.length === 0) return;
    const t = setTimeout(() => {
      const saved = writeBackup(records);
      if (saved) setBackup(saved);
    }, 1200);
    return () => clearTimeout(t);
  }, [records]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D+/g, "");
    if (!q) return records;
    return records.filter((r) => {
      const hay = `${r.nome ?? ""} ${r.email ?? ""} ${r.endereco ?? ""} ${r.cidade ?? ""}`.toLowerCase();
      const nums = `${r.telefone ?? ""}${r.cep ?? ""}${r.cpf ?? ""}`.replace(/\D+/g, "");
      return hay.includes(q) || (digits.length >= 3 && nums.includes(digits));
    });
  }, [records, query]);

  const pendingSweep = useMemo(
    () => records.filter((r) => r._id && sweepPatch(r)).length,
    [records],
  );

  const runSweep = async () => {
    const targets = records
      .map((r) => ({ id: r._id, patch: r._id ? sweepPatch(r) : null }))
      .filter((t): t is { id: string; patch: Patch } => Boolean(t.id && t.patch));
    if (targets.length === 0) {
      toast.success("Todas as fichas já estão padronizadas");
      return;
    }
    setSweep({ done: 0, total: targets.length });
    let ok = 0;
    for (const t of targets) {
      try {
        await onUpdate(t.id, t.patch);
        ok++;
      } catch {
        /* continua */
      }
      setSweep({ done: ok, total: targets.length });
    }
    setSweep(null);
    toast.success(`${ok} ficha(s) corrigida(s) na varredura`);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const tel = norm(editing.telefone);
    if (!isValidPhone(tel)) {
      toast.error("Telefone inválido — use DDD + número, ex: (11) 91234-5678");
      return;
    }
    setSaving(true);
    try {
      await onUpdate(editing.id, {
        nome: norm(editing.nome) ? titleCase(norm(editing.nome)) : null,
        email: norm(editing.email) ? norm(editing.email).toLowerCase() : null,
        telefone: tel ? formatPhone(tel) : null,
        cep: norm(editing.cep) ? formatCep(norm(editing.cep)) : null,
        endereco: norm(editing.endereco) || null,
      });
      toast.success("Ficha atualizada");
      setEditing(null);
    } catch {
      toast.error("Falha ao salvar a ficha");
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    const b = backup ?? readBackup();
    if (!b || b.records.length === 0) return toast.error("Nenhum backup encontrado");
    setRestoring(true);
    try {
      await onRestore(b.records);
      toast.success(`${b.records.length} cadastro(s) restaurado(s) do backup`);
    } catch {
      toast.error("Falha ao restaurar o backup");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <HardDrive className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold">Backup na pasta do app</div>
            <div className="text-xs text-muted-foreground">
              {backup
                ? `Último salvamento: ${new Date(backup.savedAt).toLocaleString("pt-BR")} · ${backup.count} cadastro(s)`
                : "Nenhum backup salvo ainda"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const saved = writeBackup(records);
              if (saved) {
                setBackup(saved);
                toast.success("Backup salvo na pasta do app");
              } else toast.error("Não foi possível salvar o backup");
            }}
          >
            <Save className="w-4 h-4 mr-2" /> Salvar backup
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!backup}
            onClick={() => backup && downloadBackup(backup)}
          >
            <Download className="w-4 h-4 mr-2" /> Baixar .json
          </Button>
          <Button variant="secondary" size="sm" disabled={!backup || restoring} onClick={restore}>
            {restoring ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4 mr-2" />
            )}
            Recuperar
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, e-mail, telefone ou CEP"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" disabled={!!sweep} onClick={runSweep}>
          {sweep ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4 mr-2" />
          )}
          {sweep
            ? `Varrendo ${sweep.done}/${sweep.total}`
            : `Varredura completa${pendingSweep ? ` (${pendingSweep})` : ""}`}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <User className="w-10 h-10 mx-auto mb-3 opacity-50" />
          Nenhuma ficha encontrada.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((r) => (
            <Card key={r._id ?? r._arquivo} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-2 border-b pb-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {r.nome || <span className="italic text-muted-foreground">Sem nome</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r._arquivo}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!r._id}
                  onClick={() =>
                    setEditing({
                      id: r._id as string,
                      nome: r.nome ?? "",
                      email: r.email ?? "",
                      telefone: r.telefone ?? "",
                      cep: r.cep ?? "",
                      endereco: r.endereco ?? "",
                    })
                  }
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                </Button>
              </div>
              <Row icon={<Mail className="w-3.5 h-3.5" />} label="E-mail" value={r.email} />
              <Row icon={<Phone className="w-3.5 h-3.5" />} label="Telefone" value={r.telefone} />
              <Row icon={<MapPin className="w-3.5 h-3.5" />} label="CEP" value={r.cep} />
              <Row
                icon={<MapPin className="w-3.5 h-3.5" />}
                label="Endereço"
                value={[r.endereco, r.numero, r.bairro, r.cidade, r.estado]
                  .filter(Boolean)
                  .join(", ")}
              />
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar ficha de contato</DialogTitle>
            <DialogDescription>
              As alterações são salvas na nuvem e sincronizadas no celular.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  value={editing.nome ?? ""}
                  onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={editing.email ?? ""}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input
                  value={editing.telefone ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, telefone: maskPhoneInput(e.target.value) })
                  }
                  className={isValidPhone(norm(editing.telefone)) ? "" : "border-destructive"}
                />
                {!isValidPhone(norm(editing.telefone)) && (
                  <p className="text-xs text-destructive">
                    Formato inválido — use DDD + número, ex: (11) 91234-5678
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>CEP</Label>
                <Input
                  value={editing.cep ?? ""}
                  onChange={(e) => setEditing({ ...editing, cep: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Endereço</Label>
                <Input
                  value={editing.endereco ?? ""}
                  onChange={(e) => setEditing({ ...editing, endereco: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-muted-foreground mt-0.5">{icon}</span>
      <span className="text-xs text-muted-foreground w-20 shrink-0 mt-0.5">{label}</span>
      <span className="font-medium break-words">{value || "—"}</span>
    </div>
  );
}
