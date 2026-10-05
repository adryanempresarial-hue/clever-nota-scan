// Server-only App User Connector helpers. Never import from browser code.

function requireApiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY is not set.");
  return key;
}

export async function authorizeAppUserOAuth(params: {
  gatewayBaseUrl: string;
  connectorId: string;
  appUserId: string;
  clientAPIKey: string;
  returnUrl: string;
  connectionAPIKey?: string;
  credentialsConfiguration?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${requireApiKey()}`,
    "Content-Type": "application/json",
    "X-Client-Api-Key": params.clientAPIKey,
  };
  if (params.connectionAPIKey) headers["X-Connection-Api-Key"] = params.connectionAPIKey;
  const res = await fetch(`${params.gatewayBaseUrl}/api/v1/app-users/oauth2/authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      connector_id: params.connectorId,
      app_user_id: params.appUserId,
      return_url: params.returnUrl,
      credentials_configuration: params.credentialsConfiguration,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao iniciar login (${res.status}): ${text}`);
  const body = JSON.parse(text || "{}") as { authorization_url?: string };
  if (!body.authorization_url) throw new Error("Resposta sem authorization_url");
  return { authorizationUrl: body.authorization_url };
}

export async function callAsAppUser(p: {
  gatewayBaseUrl: string;
  connectionAPIKey: string;
  connectorId: string;
  path: string;
  init?: RequestInit;
  requiredScopes?: string[];
}): Promise<Response> {
  const path = p.path.startsWith("/") ? p.path : `/${p.path}`;
  const headers = new Headers(p.init?.headers);
  headers.set("Authorization", `Bearer ${requireApiKey()}`);
  headers.set("X-Connection-Api-Key", p.connectionAPIKey);
  if (p.requiredScopes?.length) headers.set("X-Lovable-Required-Scopes", p.requiredScopes.join(" "));
  return fetch(`${p.gatewayBaseUrl}/${p.connectorId}${path}`, { ...p.init, headers });
}

export async function appUserReconnectRequired(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = (await res.clone().json().catch(() => null)) as { type?: unknown } | null;
  return typeof body?.type === "string" && body.type.startsWith("credential_");
}

export async function disconnectAppUser(p: {
  gatewayBaseUrl: string;
  connectionAPIKey: string;
  connectorId: string;
}): Promise<void> {
  const res = await fetch(`${p.gatewayBaseUrl}/api/v1/app-users/connection`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "X-Connection-Api-Key": p.connectionAPIKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connector_id: p.connectorId }),
  });
  if (!res.ok) throw new Error(`Falha ao desconectar (${res.status}): ${await res.text()}`);
}

export async function exchangeAppUserOAuthCode(
  gatewayBaseUrl: string,
  code: string,
): Promise<{ connectionAPIKey: string; connectorId: string }> {
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/oauth2/exchange`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao concluir login (${res.status}): ${text}`);
  const body = JSON.parse(text || "{}") as { api_key?: string; connector_id?: string };
  if (!body.api_key || !body.connector_id) throw new Error("Resposta de login incompleta");
  return { connectionAPIKey: body.api_key, connectorId: body.connector_id };
}
