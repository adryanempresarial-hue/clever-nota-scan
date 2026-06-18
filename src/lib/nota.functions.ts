import { createServerFn } from "@tanstack/react-start";
import { generateObject } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const FileInput = z.object({
  name: z.string(),
  mimeType: z.string(),
  dataBase64: z.string(),
});

const Input = z.object({
  files: z.array(FileInput).min(1).max(10),
});

const RecordSchema = z.object({
  nome: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  telefone: z.string().optional().nullable(),
  cep: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  bairro: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(),
  estado: z.string().optional().nullable(),
  notaFiscal: z.string().optional().nullable(),
  data: z.string().optional().nullable(),
  valor: z.string().optional().nullable(),
});

export type NotaRecord = z.infer<typeof RecordSchema> & { _arquivo: string };

const SYSTEM = `Você é um extrator de dados de notas fiscais, comprovantes e documentos brasileiros.
Extraia APENAS os campos solicitados encontrados no documento. Omita (deixe null) campos que não estiverem presentes.
Formate CPF como 000.000.000-00, CNPJ como 00.000.000/0000-00, CEP como 00000-000, telefone como (XX) XXXXX-XXXX, datas como DD/MM/AAAA, valor como R$ 0,00.`;

export const extractFromFiles = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<{ records: NotaRecord[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const results = await Promise.all(
      data.files.map(async (file) => {
        const dataUrl = `data:${file.mimeType};base64,${file.dataBase64}`;
        const isPdf = file.mimeType === "application/pdf";
        try {
          const { object } = await generateObject({
            model,
            schema: RecordSchema,
            system: SYSTEM,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "Extraia os dados do documento abaixo." },
                  isPdf
                    ? { type: "file", data: dataUrl, mediaType: file.mimeType, filename: file.name }
                    : { type: "image", image: dataUrl },
                ] as never,
              },
            ],
          });
          console.log("[NOTA] EXTRACTED_DATA", file.name, JSON.stringify(object));
          return { ...object, _arquivo: file.name } as NotaRecord;
        } catch (e) {
          console.error("extract failed for", file.name, e);
          return { _arquivo: file.name } as NotaRecord;
        }
      }),
    );

    console.log("[NOTA] OCR_RESULT total registros:", results.length);
    return { records: results };
  });