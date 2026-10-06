import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authorizeAppUserOAuth, callAsAppUser, disconnectAppUser, exchangeAppUserOAuthCode,
} from "@/integrations/lovable/appUserConnector.server";
import {
  deleteConnection, getConnection, saveConnection, setAccountEmail,
} from "@/lib/appUserConnections.server";

const GATEWAY = "https://connector-gateway.lovable.dev";

type Provider = "gmail" | "outlook";

const CONNECTOR: Record<Provider, string> = { gmail: "google_mail", outlook: "microsoft_outlook" };
const SCOPES: Record<Provider, string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  outlook: ["offline_access", "User.Read", "Mail.Read"],
};
const CLIENT_ENV: Record<Provider, string> = {
  gmail: "GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY",
  outlook: "MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY",
};
const BASE_PATH: Record<Provider, string> = { gmail: "/gmail/v1", outlook: "/v1.0" };

async function gatewayFetch(key: string, provider: Provider, path: string, init?: RequestInit): Promise<Response> {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY,
    connectionAPIKey: key,
    connectorId: CONNECTOR[provider],
    path: `${BASE_PATH[provider]}${path}`,
    init,
    requiredScopes: SCOPES[provider],
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email-crm] ${provider} ${path} -> ${res.status}: ${body}`);
    if (res.status === 401) throw new Error("Seu acesso ao e-mail precisa ser renovado. Clique em Entrar novamente.");
    throw new Error(`Falha ao acessar o e-mail [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res;
}

const ProviderInput = z.object({ provider: z.enum(["gmail", "outlook"]) });

/** Estado do login de cada provedor para o usuário atual. */
export const getEmailProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const out: Record<Provider, { available: boolean; connected: boolean; email: string | null }> = {
      gmail: { available: false, connected: false, email: null },
      outlook: { available: false, connected: false, email: null },
    };
    for (const p of ["gmail", "outlook"] as Provider[]) {
      out[p].available = Boolean(process.env[CLIENT_ENV[p]]);
      try {
        const c = await getConnection(context.userId, CONNECTOR[p]);
        if (c) { out[p].connected = true; out[p].email = c.accountEmail ?? null; }
      } catch { /* ignora */ }
    }
    return out;
  });

export const startEmailLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProviderInput.parse(d))
  .handler(async ({ data, context }) => {
    const clientKey = process.env[CLIENT_ENV[data.provider]];
    if (!clientKey) throw new Error("Login deste provedor ainda não foi configurado.");
    const request = getRequest();
    const url = new URL(request.url);
    const sandboxHost = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = new URL("/oauth/email/return", sandboxHost ? `https://${sandboxHost}` : url.origin).toString();
    const existing = await getConnection(context.userId, CONNECTOR[data.provider]).catch(() => null);
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY,
      connectorId: CONNECTOR[data.provider],
      appUserId: context.userId,
      clientAPIKey: clientKey,
      returnUrl,
      connectionAPIKey: existing?.apiKey,
      credentialsConfiguration: { scopes: SCOPES[data.provider] },
    });
    return { authorizationUrl };
  });

export const completeEmailLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ provider: z.enum(["gmail", "outlook"]), code: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY, data.code);
    if (connectorId !== CONNECTOR[data.provider]) throw new Error("Conector inesperado");
    await saveConnection(context.userId, connectorId, connectionAPIKey);
    // descobre o e-mail logado
    try {
      const res = await gatewayFetch(connectionAPIKey, data.provider, data.provider === "gmail" ? "/users/me/profile" : "/me");
      const j = (await res.json()) as { emailAddress?: string; mail?: string; userPrincipalName?: string };
      const email = (j.emailAddress ?? j.mail ?? j.userPrincipalName ?? "").toLowerCase();
      if (email) await setAccountEmail(context.userId, connectorId, email);
      return { ok: true, email };
    } catch {
      return { ok: true, email: "" };
    }
  });

export const logoutEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProviderInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getConnection(context.userId, CONNECTOR[data.provider]);
    if (c) {
      await disconnectAppUser({ gatewayBaseUrl: GATEWAY, connectionAPIKey: c.apiKey, connectorId: CONNECTOR[data.provider] }).catch(() => {});
      await deleteConnection(context.userId, CONNECTOR[data.provider]);
    }
    return { ok: true };
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
    const conn = await getConnection(context.userId, CONNECTOR[data.provider]);
    if (!conn) throw new Error("Entre com sua conta de e-mail antes de varrer.");
    const contaEmail = conn.accountEmail || data.provider;
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
      const list = await (await gatewayFetch(conn.apiKey, "gmail", listPath)).json() as {
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
              const r = await gatewayFetch(conn.apiKey, "gmail", `/users/me/messages/${id}?format=full`);
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
        conn.apiKey, "outlook",
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
        .eq("conta_email", contaEmail)
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
          conta_email: contaEmail,
        });
        if (!error) inserted++;
      }
    }

    return { scanned, found: contacts.size, inserted, updated, nextPageToken };
  });
