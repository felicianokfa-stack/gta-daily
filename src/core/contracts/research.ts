import { z } from "zod";
import { EvidenceLabel, SourceRef } from "./common";

/** Entrada do Pesquisador: o tema e o contexto do nicho que o orquestrador injeta. */
export const ResearchInput = z.object({
  topic: z.string().trim().min(3).max(500),
  goal: z.string().trim().max(500).default(""),
  niche_id: z.string().min(1),
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
  contradictions: z.array(z.string().max(1000)),
  caveats: z.array(z.string().max(1000)),
  overall: z.string().min(1).max(1500),
});
export type VerificationResult = z.infer<typeof VerificationResult>;
