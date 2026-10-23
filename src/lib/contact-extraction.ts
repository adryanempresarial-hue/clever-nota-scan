import { z } from "zod";
import { mergeContactEmails, mergeContactPhones } from "./contact-values";

export const ContactRecordSchema = z.object({
  dtAlteracao: z.string().optional().nullable(), dtCadastro: z.string().optional().nullable(),
  nome: z.string().optional().nullable(), cpf: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(), email: z.string().optional().nullable(),
  telefone: z.string().optional().nullable(), cep: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(), numero: z.string().optional().nullable(),
  uh: z.string().optional().nullable(), bairro: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(), estado: z.string().optional().nullable(),
  notaFiscal: z.string().optional().nullable(), data: z.string().optional().nullable(),
  valor: z.string().optional().nullable(),
});

export const ContactExtractionSchema = z.object({ records: z.array(ContactRecordSchema) });

export function assembleExtractedContacts(records: z.infer<typeof ContactRecordSchema>[], source: string) {
  return records.filter(record => Object.values(record).some(value => typeof value === "string" && value.trim())).map((record, index, all) => ({
    ...record,
    email: record.email ? mergeContactEmails([record.email]) : "",
    telefone: record.telefone ? mergeContactPhones([record.telefone]) : "",
    _arquivo: all.length > 1 ? `${source} · registro ${index + 1}` : source,
  }));
}