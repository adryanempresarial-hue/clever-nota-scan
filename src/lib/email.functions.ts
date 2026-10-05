import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GMAIL_GATEWAY = "https://connector-gateway.lovable.dev/google_mail";

type Provider = "gmail" | "outlook";

function providerKey(provider: Provider): string | undefined {
  if (provider === "gmail") return process.env.GOOGLE_MAIL_API_KEY;
  return process.env.MICROSOFT_OUTLOOK_API_KEY;
}

function gatewayBase(provider: Provider): string {
  if (provider === "gmail") return `${GMAIL_GATEWAY}/gmail/v1`;
  return `https://connector-gateway.lovable.dev/microsoft_outlook/v1.0`;
}

async function gatewayFetch(provider: Provider, path: string, init?: RequestInit): Promise<Response> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = providerKey(provider);
  if (!lovableKey || !connKey) throw new Error(`Conexão ${provider} não configurada`);
  const res = await fetch(`${gatewayBase(provider)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email-crm] gateway ${provider} ${path} -> ${res.status}: ${body}`);
    throw new Error(`Falha ao acessar o e-mail [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res;
}

/** Quais provedores estão conectados (sem expor segredos). */
export const getEmailProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return {
      gmail: Boolean(process.env.GOOGLE_MAIL_API_KEY),
      outlook: Boolean(process.env.MICROSOFT_OUTLOOK_API_KEY),
    };
  });

// ---------- extração ----------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}/g;
const CPF_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CEP_RE = /\b\d{5}-\d{3}\b/g;

const SKIP_DOMAINS = new Set([
  "noreply", "no-reply", "donotreply", "mailer-daemon", "postmaster",
]);

function parseFrom(header: string): { nome: string; email: string } | null {
  const m = header.match(/^(?:"?([^"<]+)"?\s*)?<([^>]+)>/);
  if (m) return { nome: (m[1] ?? "").trim(), email: m[2]!.trim().toLowerCase() };
  const e = header.match(EMAIL_RE);
  if (e) return { nome: "", email: e[0]!.toLowerCase() };
  return null;
}

function isJunkEmail(email: string): boolean {
  const local = email.split("@")[0]!.toLowerCase();
  return SKIP_DOMAINS.has(local) || local.includes("noreply") || local.includes("no-reply");
}

function firstMatch(re: RegExp, text: string): string {
  const m = text.match(re);
  return m?.[0] ?? "";
}

function decodeBody(payload: unknown): string {
  // extrai texto de payload Gmail (format=full)
  const chunks: string[] = [];
  const walk = (p: any) => {
    if (!p || typeof p !== "object") return;
    if (p.mimeType === "text/plain" && p.body?.data) {
      try {
        chunks.push(Buffer.from(p.body.data, "base64url").toString("utf8"));
      } catch { /* ignora */ }
    }
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  };
  walk(payload);
  return chunks.join("\n").slice(0, 20000);
}

export type ScannedContact = {
  nome: string;
  email: string;
  telefone: string;
  cpf: string;
  cep: string;
  origem: string;
};

const ScanInput = z.object({
  provider: z.enum(["gmail", "outlook"]),
  pageToken: z.string().optional(),
  maxMessages: z.number().min(1).max(500).default(100),
});

/** Varre uma página de e-mails e devolve contatos extraídos + token de continuação. */
export const scanEmailContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ScanInput.parse(data))
  .handler(async ({ data, context }) => {
    const contacts = new Map<string, ScannedContact>();

    const addContact = (c: ScannedContact) => {
      if (!c.email || isJunkEmail(c.email)) return;
      const prev = contacts.get(c.email);
      if (!prev) {
        contacts.set(c.email, c);
        return;
      }
      // enriquece o existente
      contacts.set(c.email, {
        email: c.email,
        nome: prev.nome || c.nome,
        telefone: prev.telefone || c.telefone,
        cpf: prev.cpf || c.cpf,
        cep: prev.cep || c.cep,
        origem: prev.origem || c.origem,
      });
    };

    let nextPageToken: string | null = null;
    let scanned = 0;

    if (data.provider === "gmail") {
      const listPath = `/users/me/messages?maxResults=${Math.min(data.maxMessages, 500)}${data.pageToken ? `&pageToken=${encodeURIComponent(data.pageToken)}` : ""}`;
      const list = await (await gatewayFetch("gmail", listPath)).json() as {
        messages?: { id: string }[];
        nextPageToken?: string;
      };
      nextPageToken = list.nextPageToken ?? null;
      const ids = (list.messages ?? []).map((m) => m.id);

      // busca em lotes de 20 (format=full para ler corpo)
      for (let i = 0; i < ids.length; i += 20) {
        const batch = ids.slice(i, i + 20);
        const msgs = await Promise.all(
          batch.map(async (id) => {
            try {
              const r = await gatewayFetch("gmail", `/users/me/messages/${id}?format=full`);
              return (await r.json()) as any;
            } catch {
              return null;
            }
          }),
        );
        for (const msg of msgs) {
          if (!msg) continue;
          scanned++;
          const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
          const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
          const from = parseFrom(h("From"));
          const subject = h("Subject");
          const date = h("Date");
          const body = decodeBody(msg.payload);
          const text = `${subject}\n${body}`;
          const telefone = firstMatch(PHONE_RE, text);
          const cpf = firstMatch(CPF_RE, text);
          const cep = firstMatch(CEP_RE, text);
          const origem = `${subject || "(sem assunto)"} · ${date}`.slice(0, 200);

          if (from) {
            addContact({ nome: from.nome, email: from.email, telefone, cpf, cep, origem });
          }
          // destinatários e e-mails citados no corpo
          const others = `${h("To")} ${h("Cc")} ${body}`.match(EMAIL_RE) ?? [];
          for (const e of others.slice(0, 20)) {
            addContact({ nome: "", email: e.toLowerCase(), telefone: "", cpf: "", cep: "", origem });
          }
        }
      }
    } else {
      // Outlook (Microsoft Graph via gateway)
      const skip = data.pageToken ? Number(data.pageToken) : 0;
      const list = await (await gatewayFetch(
        "outlook",
        `/me/messages?$top=${Math.min(data.maxMessages, 100)}&$skip=${skip}&$select=from,toRecipients,ccRecipients,subject,receivedDateTime,bodyPreview`,
      )).json() as { value?: any[] };
      const msgs = list.value ?? [];
      scanned = msgs.length;
      nextPageToken = msgs.length >= Math.min(data.maxMessages, 100) ? String(skip + msgs.length) : null;
      for (const msg of msgs) {
        const text = `${msg.subject ?? ""}\n${msg.bodyPreview ?? ""}`;
        const telefone = firstMatch(PHONE_RE, text);
        const cpf = firstMatch(CPF_RE, text);
        const cep = firstMatch(CEP_RE, text);
        const origem = `${msg.subject || "(sem assunto)"} · ${msg.receivedDateTime ?? ""}`.slice(0, 200);
        const fromEmail = msg.from?.emailAddress;
        if (fromEmail?.address) {
          addContact({
            nome: fromEmail.name ?? "",
            email: String(fromEmail.address).toLowerCase(),
            telefone, cpf, cep, origem,
          });
        }
        for (const r of [...(msg.toRecipients ?? []), ...(msg.ccRecipients ?? [])]) {
          const addr = r?.emailAddress?.address;
          if (addr) {
            addContact({
              nome: r.emailAddress.name ?? "",
              email: String(addr).toLowerCase(),
              telefone: "", cpf: "", cep: "", origem,
            });
          }
        }
      }
    }

    // persiste (mescla por e-mail, sem duplicar)
    const supabase = context.supabase;
    const userId = context.userId;
    let inserted = 0;
    let updated = 0;
    for (const c of contacts.values()) {
      const { data: existing } = await supabase
        .from("crm_email_contacts")
        .select("id, nome, telefone, cpf, cep")
        .eq("user_id", userId)
        .eq("email", c.email)
        .limit(1);
      const row = existing?.[0];
      if (row) {
        const patch: { nome?: string; telefone?: string; cpf?: string; cep?: string } = {};
        if (!row.nome && c.nome) patch.nome = c.nome;
        if (!row.telefone && c.telefone) patch.telefone = c.telefone;
        if (!row.cpf && c.cpf) patch.cpf = c.cpf;
        if (!row.cep && c.cep) patch.cep = c.cep;
        if (Object.keys(patch).length) {
          await supabase.from("crm_email_contacts").update(patch).eq("id", row.id);
          updated++;
        }
      } else {
        const { error } = await supabase.from("crm_email_contacts").insert({
          user_id: userId,
          nome: c.nome || null,
          email: c.email,
          telefone: c.telefone || null,
          cpf: c.cpf || null,
          cep: c.cep || null,
          origem: c.origem,
          provedor: data.provider,
        });
        if (!error) inserted++;
      }
    }

    return { scanned, found: contacts.size, inserted, updated, nextPageToken };
  });
