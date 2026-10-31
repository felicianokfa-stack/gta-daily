import { z } from "zod";
import { Transcript } from "../transcript";

/** Declaração do usuário de que pode usar o material. É obrigatória para analisar. */
export const MediaAuthorization = z.object({
  declared: z.literal(true, { error: "Confirme que você tem autorização para usar este material" }),
  basis: z.string().trim().min(3, "Descreva em uma frase a base da autorização").max(500),
});
export type MediaAuthorization = z.infer<typeof MediaAuthorization>;

/** Entrada do Analista de Conteúdo: o material (referência + transcrição com tempos) e o contexto do nicho. */
export const ContentAnalysisInput = z.object({
  media_id: z.uuid(),
  title: z.string().min(1).max(200),
  kind: z.enum(["link", "transcricao", "exemplo"]),
  is_sample: z.boolean().default(false),
  duration_seconds: z.number().int().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  transcript: Transcript,
  niche_id: z.string().min(1),
  goal: z.string().trim().max(500).default(""),
  correction_notes: z.array(z.string()).default([]),
});
export type ContentAnalysisInput = z.infer<typeof ContentAnalysisInput>;

/** Um corte sugerido, ancorado em segmentos da transcrição. */
export const ClipSuggestion = z.object({
  title: z.string().min(1).max(200).describe("Título curto e fiel ao trecho"),
  justification: z.string().min(1).max(1000).describe("Por que este trecho funciona como corte, citando o que acontece nele"),
  start_s: z.number().min(0).describe("Início em segundos, dentro da transcrição"),
  end_s: z.number().min(0).describe("Fim em segundos, dentro da transcrição"),
  segment_ids: z.array(z.number().int().min(1)).min(1).max(100).describe("Ids dos segmentos da transcrição que formam o corte"),
  score: z.object({
    value: z.number().int().min(0).max(100),
    reason: z
      .string()
      .min(1)
      .max(500)
      .describe("Interesse editorial estimado (clareza, gancho, completude). NÃO é probabilidade de viralizar."),
  }),
  risks: z.array(z.string().max(300)).max(10).describe("Riscos: rumor tratado como fato, falta de contexto, trecho incompleto…"),
});
export type ClipSuggestion = z.infer<typeof ClipSuggestion>;

export const ContentAnalysisResult = z.object({
  summary: z.string().min(1).max(2000),
  topics: z.array(z.string().min(1).max(100)).max(12),
  candidates: z.array(ClipSuggestion).max(8),
  unknowns: z.array(z.string().max(500)).describe("O que não foi possível avaliar ou faltou no material"),
});
export type ContentAnalysisResult = z.infer<typeof ContentAnalysisResult>;

/** Limites do corte candidato, em segundos (vídeos curtos). */
export const CLIP_MIN_SECONDS = 5;
export const CLIP_MAX_SECONDS = 120;
