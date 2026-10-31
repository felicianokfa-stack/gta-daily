import { z } from "zod";
import { PLATFORMS } from "../content-rules";
import { Transcript } from "../transcript";
import { EvidenceLabel } from "./common";

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

// ------------------------------------------------------------------ Produção de um corte (PR 2)

export const PlatformEnum = z.enum(PLATFORMS);

/** Contexto comum dos papéis de produção: o corte escolhido, os trechos citados e as plataformas do projeto. */
export const ClipContext = z.object({
  clip_id: z.uuid(),
  media_id: z.uuid(),
  media_title: z.string().min(1).max(200),
  is_sample: z.boolean().default(false),
  title: z.string().min(1).max(200),
  justification: z.string().min(1).max(1000),
  start_s: z.number().min(0),
  end_s: z.number().min(0),
  /** Trechos da transcrição que formam o corte (somente o que está dentro do corte). */
  segments: Transcript,
  platforms: z.array(PlatformEnum).min(1).max(4),
  niche_id: z.string().min(1),
  correction_notes: z.array(z.string()).default([]),
});
export type ClipContext = z.infer<typeof ClipContext>;

/** Rótulo permitido em mensagens: a transcrição sozinha NUNCA confirma um fato (só a pesquisa verificada confirma). */
export const MessageLabel = EvidenceLabel.exclude(["fato_confirmado"]);

// --- Estrategista
export const StrategyBrief = z.object({
  angle: z.string().min(1).max(300).describe("Ângulo editorial do corte"),
  hook: z.string().min(1).max(200).describe("Gancho dos primeiros segundos"),
  audience: z.string().min(1).max(300),
  key_messages: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        label: MessageLabel.describe("rumor, teoria, estimativa, hipotese ou nao_verificado: a transcrição não confirma fatos"),
        segment_ids: z.array(z.number().int().min(1)).min(1).max(20).describe("Segmentos da transcrição que sustentam a mensagem"),
      }),
    )
    .min(1)
    .max(6),
  cta: z.string().min(1).max(200),
  platform_priority: z.array(PlatformEnum).min(1).max(4),
  cautions: z.array(z.string().max(300)).max(10),
});
export type StrategyBrief = z.infer<typeof StrategyBrief>;
export const StrategistInput = ClipContext;
export type StrategistInput = z.infer<typeof StrategistInput>;

// --- Roteirista
export const ScriptResult = z.object({
  beats: z
    .array(
      z.object({
        t_start: z.number().min(0),
        t_end: z.number().min(0),
        voiceover: z.string().min(1).max(400),
        on_screen_text: z.string().max(120),
        segment_id: z.number().int().min(1).nullable().describe("Segmento da transcrição em que a batida se baseia, ou null"),
        quote: z.string().max(300).nullable().describe("Citação LITERAL do segmento, ou null. Nunca parafrasear aqui."),
      }),
    )
    .min(1)
    .max(20),
  total_seconds: z.number().min(1),
  disclaimers: z.array(z.string().max(300)).max(5),
});
export type ScriptResult = z.infer<typeof ScriptResult>;
export const ScriptwriterInput = ClipContext.extend({ brief: StrategyBrief });
export type ScriptwriterInput = z.infer<typeof ScriptwriterInput>;

// --- Produtor Audiovisual (plano de edição, NÃO renderização)
export const ProductionPlan = z.object({
  format: z.literal("9:16"),
  rendered: z.literal(false).describe("Sempre false: este é um plano, nenhum arquivo foi gerado"),
  summary: z.string().min(1).max(600),
  cuts: z
    .array(
      z.object({
        t_start: z.number().min(0),
        t_end: z.number().min(0),
        framing: z.string().min(1).max(200),
        note: z.string().max(200),
      }),
    )
    .min(1)
    .max(30),
  subtitles: z
    .array(z.object({ t_start: z.number().min(0), t_end: z.number().min(0), text: z.string().min(1).max(90) }))
    .min(1)
    .max(60),
  audio_notes: z.array(z.string().max(200)).max(5),
  assets_needed: z.array(z.string().max(200)).max(10),
});
export type ProductionPlan = z.infer<typeof ProductionPlan>;
export const ProducerInput = ClipContext.extend({ brief: StrategyBrief, script: ScriptResult });
export type ProducerInput = z.infer<typeof ProducerInput>;

// --- Distribuidor (metadados por plataforma; não publica)
export const PlatformVersion = z.object({
  platform: PlatformEnum,
  title: z.string().min(1).max(100),
  caption: z.string().min(1).max(5000),
  hashtags: z.array(z.string().min(2).max(61)).max(30),
  cover_text: z.string().max(60),
  timing_note: z.string().max(200),
});
export type PlatformVersion = z.infer<typeof PlatformVersion>;
export const Distribution = z.object({ versions: z.array(PlatformVersion).min(1).max(4) });
export type Distribution = z.infer<typeof Distribution>;
export const DistributorInput = ClipContext.extend({ brief: StrategyBrief, script: ScriptResult });
export type DistributorInput = z.infer<typeof DistributorInput>;

// --- Revisor de Qualidade
export const ReviewResult = z.object({
  verdict: z.enum(["aprovado_para_revisao", "ajustes", "reprovado"]),
  summary: z.string().min(1).max(800),
  checks: z
    .array(z.object({ rule: z.string().min(1).max(100), passed: z.boolean(), detail: z.string().max(300) }))
    .min(1)
    .max(12),
  issues: z.array(z.string().max(300)).max(10),
  suggested_fixes: z.array(z.string().max(300)).max(10),
});
export type ReviewResult = z.infer<typeof ReviewResult>;
export const ReviewerInput = ClipContext.extend({
  brief: StrategyBrief,
  script: ScriptResult,
  plan: ProductionPlan,
  distribution: Distribution,
});
export type ReviewerInput = z.infer<typeof ReviewerInput>;
