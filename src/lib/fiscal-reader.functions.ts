import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const readFiscalDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ name: z.string(), text: z.string().max(250000).optional(), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]).optional(), base64: z.string().max(21000000).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: access, error: accessError } = await context.supabase.from("fiscal_ai_access").select("blocked, reason").eq("user_id", context.userId).maybeSingle();
    if (accessError) throw new Error("Não foi possível verificar o acesso ao leitor.");
    if (access?.blocked) throw new Error(access.reason ?? "A leitura por IA está pausada. Restaure o acesso antes de tentar novamente.");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("A leitura por IA não está configurada.");
    let blockReason: string | undefined;
    try {
      const { PaymentExtractionSchema, extractFiscalDocument } = await import("./fiscal-reader-ai.server");
      const extraction = await extractFiscalDocument(data, key, async (status, message) => {
        if (status === 402 || status === 403) blockReason = message;
      });
      return PaymentExtractionSchema.parse(extraction);
    } catch (error) {
      if (blockReason) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("fiscal_ai_access").upsert({ user_id: context.userId, blocked: true, reason: blockReason, updated_at: new Date().toISOString() });
        throw new Error(blockReason);
      }
      throw error instanceof Error ? error : new Error("Não foi possível extrair o documento.");
    }
  });