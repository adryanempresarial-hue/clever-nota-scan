import { createServerFn } from "@tanstack/react-start";
import { generateObject } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { ContactRecordSchema, ContactExtractionSchema, assembleExtractedContacts } from "./contact-extraction";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FileInput = z.object({
  name: z.string(),
  mimeType: z.string(),
  dataBase64: z.string(),
});

const Input = z.object({
  files: z.array(FileInput).min(1).max(10),
});

export type NotaRecord = z.infer<typeof ContactRecordSchema> & { _arquivo: string };

const SYSTEM = `Você é um extrator OCR especializado em documentos brasileiros (notas fiscais, comprovantes, RGs, CNHs, cartões de visita, contratos, fichas cadastrais).

Retorne um array records com TODOS os contatos/linhas em TODAS as páginas, não apenas um contato por arquivo. Cada pessoa ou linha de cadastro é um registro independente; nunca misture dados de pessoas diferentes. Preserve registros parciais. Para cada contato, transcreva TODOS os e-mails e TODOS os telefones, separados por ponto e vírgula, sem escolher apenas um. Extraia UH/apartamento no campo uh, preservando zeros (021), separado do numero residencial. Preencha também todos os componentes legíveis do endereço. Nunca invente, complete dígitos ilegíveis ou transfira dados de outro contato. Campo ausente fica vazio, não escreva a palavra null.

EXTRAIA SEMPRE estes 6 campos prioritários, nesta ordem:
1. nome      — nome completo da pessoa física OU razão social/nome fantasia. Prefira destinatário/cliente/tomador/contratante/titular. NUNCA deixe vazio se houver QUALQUER nome legível.
2. cpf       — formato 000.000.000-00
3. telefone  — formato (XX) XXXXX-XXXX (ou (XX) XXXX-XXXX para fixo). NUNCA inclua o código do país (+55 / 0055 / 55): retorne apenas DDD + número.
4. email     — sempre em minúsculas
5. cep       — formato 00000-000
6. numero    — número do endereço (apenas o número do imóvel)

Leia TODO o texto visível (cabeçalhos, rodapés, carimbos, manuscrito, tabelas, colunas laterais) antes de responder. Só deixe null o que REALMENTE não aparece. Você pode preencher os demais campos do schema se forem visíveis, mas os 6 acima são OBRIGATÓRIOS sempre que existirem no documento.

REGRA CRÍTICA PARA "nome" (nunca retorne null se houver qualquer nome no documento):
- Procure por rótulos como: Nome, Nome completo, Cliente, Hóspede, Titular, Responsável, Passageiro, Destinatário, Tomador, Contratante, Locatário, Beneficiário, Sacado, Favorecido, Razão Social, Nome Fantasia, Sr./Sra.
- Se não houver rótulo, use a linha de texto com 2 ou mais palavras alfabéticas que pareça um nome próprio (sem dígitos), mesmo que manuscrita ou em caixa alta.
- Se houver colunas separadas de nome e sobrenome, junte as duas.
- Se aparecerem vários nomes, escolha o do cliente/hóspede/destinatário, nunca o do emitente/hotel/empresa prestadora — a menos que só exista um nome.
- Nomes em CAIXA ALTA devem ser convertidos para Title Case.

Formate CNPJ como 00.000.000/0000-00, datas como DD/MM/AAAA, valores como R$ 0,00 e estado como sigla de 2 letras (ex.: RJ, SP).

REGRA CRÍTICA PARA NÚMEROS (nunca abrevie):
- Transcreva números EXATAMENTE como aparecem no documento, dígito por dígito, incluindo separadores de milhar e casas decimais.
- Se está escrito "2.000", retorne "2.000" — NUNCA "2.0", "2" ou "2 mil".
- Se está escrito "1.500,00", retorne "1.500,00" — NUNCA "1.5" ou "1500".
- Proibido arredondar, truncar, abreviar (k, mil) ou converter notação. Copie o valor literalmente.
- Isso vale para numero, valor, notaFiscal, quantidades e qualquer outro campo numérico.`;

export const extractFromFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
        schema: ContactExtractionSchema,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Varra todas as páginas e todas as linhas. Retorne records com cada contato identificado e todos os campos visíveis (nome, CPF/CNPJ, todos os telefones, todos os e-mails, CEP, endereço, número residencial e UH). Confira a última linha e os rodapés. Não omita contatos parciais nem invente dados.",
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
          const object = await extractOne(file);
          const contacts = assembleExtractedContacts(object.records, file.name);
          if (!contacts.length) throw new Error(`Nenhum campo legível identificado em ${file.name}. Confira o original e envie novamente com melhor nitidez.`);
          return contacts.map(contact => normalize(contact) as NotaRecord);
        } catch (e) {
          throw new Error(`${file.name}: ${e instanceof Error ? e.message : "Não foi possível ler este documento. Envie novamente."}`);
        }
      }),
    );

    return { records: results.flat() };
  });