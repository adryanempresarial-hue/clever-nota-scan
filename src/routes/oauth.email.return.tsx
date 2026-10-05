import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/oauth/email/return")({
  head: () => ({
    meta: [
      { title: "Conectando e-mail — D4S" },
      { name: "description", content: "Finalizando o login da conta de e-mail." },
      { property: "og:title", content: "Conectando e-mail — D4S" },
      { property: "og:description", content: "Finalizando o login da conta de e-mail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OAuthReturn,
});

function OAuthReturn() {
  const [msg, setMsg] = useState("Finalizando conexão…");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connectorId = p.get("connector_id");
    const send = (type: string, code?: string | null) => {
      window.opener?.postMessage({ type, connectorId, code: code ?? null }, window.location.origin);
      window.close();
    };
    if (p.get("success") !== "true") {
      setMsg(p.get("error") ?? "Login não concluído.");
      send("appUserConnectorOAuthFailed");
      return;
    }
    send("appUserConnectorOAuthComplete", p.get("code"));
  }, []);
  return <p className="p-6 text-sm">{msg}</p>;
}
