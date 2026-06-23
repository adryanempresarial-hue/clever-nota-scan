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

const SYSTEM = `Você é um extrator OCR especializado em notas fiscais, comprovantes, RGs, CNHs, cartões de visita, contratos e documentos brasileiros em geral.

OBRIGATÓRIO:
- LEIA TODO o texto visível na imagem antes de responder, incluindo cabeçalhos, rodapés, carimbos e textos manuscritos.
- Preencha o MÁXIMO de campos possível. Só deixe null o que REALMENTE não aparece no documento.
- O campo "nome" é o mais importante: extraia o nome completo da pessoa física OU razão social/nome fantasia da empresa (tomador, sacado, destinatário, cliente, contratante, portador, titular ou similar). NUNCA deixe "nome" vazio se houver qualquer nome legível no documento.
- Se houver mais de um nome (ex.: emitente e destinatário), prefira o DESTINATÁRIO/CLIENTE/TOMADOR.
- Endereço: separe logradouro (endereco), número, bairro, cidade, estado (UF, 2 letras) e CEP.

FORMATAÇÃO:
- CPF: 000.000.000-00
- CNPJ: 00.000.000/0000-00
- CEP: 00000-000
- Telefone: (XX) XXXXX-XXXX
- Data: DD/MM/AAAA
- Valor: R$ 0,00
- Estado: sigla com 2 letras maiúsculas (ex: RJ, SP)

Responda SEMPRE com o JSON estruturado conforme o schema, mesmo que precise inferir formatação.`;

export const extractFromFiles = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<{ records: NotaRecord[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const extractOne = async (file: typeof data.files[number]) => {
      const dataUrl = `data:${file.mimeType};base64,${file.dataBase64}`;
      const isPdf = file.mimeType === "application/pdf";
      const { object } = await generateObject({
        model,
        schema: RecordSchema,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Leia TODO o documento abaixo e extraia TODOS os campos visíveis. Não deixe o campo nome vazio se houver qualquer nome no documento.",
              },
              isPdf
                ? { type: "file", data: dataUrl, mediaType: file.mimeType, filename: file.name }
                : { type: "image", image: dataUrl },
            ] as never,
          },
        ],
      });
      return object;
    };

    const isEmpty = (obj: Record<string, unknown>) =>
      Object.values(obj).every((v) => v == null || v === "");

    const LOWER = new Set(["de", "da", "do", "das", "dos", "e", "di", "du"]);
    const toTitle = (s: string) =>
      s
        .toLocaleLowerCase("pt-BR")
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) =>
          LOWER.has(w) && i > 0
            ? w
            : w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1),
        )
        .join(" ");

    const normalize = (r: Record<string, unknown>) => {
      if (typeof r.nome === "string" && r.nome.trim()) r.nome = toTitle(r.nome.trim());
      if (typeof r.email === "string" && r.email.trim())
        r.email = r.email.trim().toLowerCase();
      return r;
    };

    const results = await Promise.all(
      data.files.map(async (file) => {
        try {
          let object = await extractOne(file);
          if (isEmpty(object as Record<string, unknown>)) {
            console.log("[NOTA] RETRY empty result for", file.name);
            object = await extractOne(file);
          }
          normalize(object as Record<string, unknown>);
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