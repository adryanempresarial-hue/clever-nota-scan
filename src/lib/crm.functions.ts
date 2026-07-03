import { createServerFn } from "@tanstack/react-start";
import { generateObject } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const FileInput = z.object({
  name: z.string(),
  mimeType: z.string(),
  dataBase64: z.string(),
});

const Input = z.object({ file: FileInput });

const CrmSchema = z.object({
  documento_tipo: z.string().optional().nullable(),
  campos: z
    .array(
      z.object({
        rotulo: z.string(),
        valor: z.string(),
      }),
    )
    .default([]),
});

export type CrmExtraction = z.infer<typeof CrmSchema> & { arquivo: string };

const SYSTEM = `Você é um extrator OCR completo para o módulo CRM.

OBJETIVO: leia TODO o documento (frente e verso, cabeçalhos, rodapés, tabelas, carimbos, campos manuscritos) e devolva TODOS os campos identificáveis, sem omitir nada.

Formato de resposta:
- documento_tipo: descreva brevemente o tipo (ex.: "Nota Fiscal", "RG", "CNH", "Comprovante de residência", "Cartão de visita", "Contrato", "Ficha cadastral").
- campos: uma lista de pares { rotulo, valor } com CADA informação legível do documento. Use rótulos claros em português (ex.: "Nome completo", "CPF", "RG", "Data de nascimento", "Endereço", "Cidade", "Estado", "CEP", "Telefone", "E-mail", "Empresa", "Cargo", "CNPJ", "Inscrição estadual", "Número da nota", "Data de emissão", "Valor total", "Forma de pagamento", "Chave PIX", "Observações"). Adicione TODOS os campos relevantes que aparecerem — não se limite a uma lista fixa.

Regras:
- Nunca invente dados. Se não estiver visível, não inclua o campo.
- Formate CPF como 000.000.000-00, CNPJ como 00.000.000/0000-00, CEP como 00000-000, telefone como (XX) XXXXX-XXXX, datas como DD/MM/AAAA, valores em R$ 0,00, estado como sigla de 2 letras.
- E-mails em minúsculas. Nomes em Title Case.
- Não repita o mesmo rótulo duas vezes; se houver vários (ex.: dois telefones), use "Telefone 1", "Telefone 2".`;

export const extractFullFromFile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<{ extraction: CrmExtraction }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const file = data.file;
    const dataUrl = `data:${file.mimeType};base64,${file.dataBase64}`;
    const isPdf = file.mimeType === "application/pdf";

    const { object } = await generateObject({
      model,
      schema: CrmSchema,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Leia TODO o documento e devolva TODOS os campos visíveis, sem limitar quantidade.",
            },
            isPdf
              ? { type: "file", data: dataUrl, mediaType: file.mimeType, filename: file.name }
              : { type: "image", image: dataUrl },
          ] as never,
        },
      ],
    });

    console.log("[CRM] EXTRACTED", file.name, JSON.stringify(object));
    return { extraction: { ...object, arquivo: file.name } };
  });