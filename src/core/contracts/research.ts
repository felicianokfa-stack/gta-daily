import { z } from "zod";
import { EvidenceLabel, SourceRef } from "./common";

/** Entrada do Pesquisador: o tema e o contexto do nicho que o orquestrador injeta. */
export const ResearchInput = z.object({
  topic: z.string().trim().min(3).max(500),
  goal: z.string().trim().max(500).default(""),
  niche_id: z.string().min(1),
  /** Fontes já registradas no projeto (Bloco C): o Pesquisador prioriza o que é novo. */
  known_sources: z.array(z.object({ url: z.string(), title: z.string() })).max(20).default([]),
  correction_notes: z.array(z.string()).default([]),
});
export type ResearchInput = z.infer<typeof ResearchInput>;

/** Resultado do Pesquisador (o que o modelo devolve, validado por schema). */
export const ResearchResult = z.object({
  topic: z.string().min(1),
  summary: z.string().min(1).max(2000),
  sources: z.array(SourceRef).max(15),
  claims_to_verify: z
    .array(
      z.object({
        claim: z.string().min(1).max(500),
        source_urls: z.array(z.url()).min(1),
        initial_label: EvidenceLabel.describe("Classificação preliminar; o Verificador decide a final"),
      }),
    )
    .max(15),
  unknowns: z.array(z.string().max(500)).describe("O que não foi encontrado ou não pôde ser confirmado"),
  relevance: z
    .object({
      score: z.number().int().min(0).max(100),
      reason: z.string().min(1).max(500),
    })
    .describe(
      "Interesse editorial estimado do tema para o público agora (novidade, atualidade, impacto). Não é probabilidade de viralizar.",
    ),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

/** Resultado do Verificador. */
export const VerificationResult = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().min(1).max(500),
        label: EvidenceLabel,
        confidence: z.enum(["baixa", "media", "alta"]),
        evidence_urls: z.array(z.url()),
        notes: z.string().max(1000),
      }),
    )
    .max(15),
  additional_sources: z
    .array(SourceRef)
    .max(10)
    .describe("Fontes novas encontradas pelo Verificador na busca e citadas como evidência"),
  contradictions: z.array(z.string().max(1000)),
  caveats: z.array(z.string().max(1000)),
  overall: z.string().min(1).max(1500),
});
export type VerificationResult = z.infer<typeof VerificationResult>;
