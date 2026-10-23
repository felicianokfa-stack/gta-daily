import { z } from "zod";

/** Papéis funcionais da especificação (seção 2.2). Só os marcados como `implemented` rodam no Bloco B. */
export const AGENT_ROLES = [
  "pesquisador",
  "verificador",
  "analista_conteudo",
  "estrategista",
  "roteirista",
  "produtor_audiovisual",
  "revisor_qualidade",
  "distribuidor",
  "analista_desempenho",
] as const;
export const AgentRole = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof AgentRole>;

export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_input",
  "succeeded",
  "failed_retryable",
  "failed_action_required",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PIPELINE_STATUSES = [
  "queued",
  "running",
  "waiting_input",
  "succeeded",
  "failed_action_required",
  "cancelled",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Classificação editorial exigida pelo princípio de confiabilidade (seção 1). */
export const EvidenceLabel = z.enum([
  "fato_confirmado",
  "rumor",
  "teoria",
  "estimativa",
  "hipotese",
  "nao_verificado",
]);
export type EvidenceLabel = z.infer<typeof EvidenceLabel>;

export const SourceRef = z.object({
  url: z.url(),
  title: z.string().min(1).max(300),
  publisher: z.string().max(120).nullable(),
  published_at: z.string().max(40).nullable().describe("Data de publicação como aparece na fonte, ou null"),
});
export type SourceRef = z.infer<typeof SourceRef>;

/**
 * Contrato padrão de saída de qualquer agente (seção 8).
 * O envelope é montado pelo orquestrador; o modelo só produz `result`.
 */
export function agentOutputEnvelope<R extends z.ZodType>(result: R) {
  return z.object({
    task_id: z.uuid(),
    project_id: z.uuid(),
    run_id: z.uuid(),
    agent_role: AgentRole,
    agent_version: z.string().min(1),
    status: z.literal("completed"),
    result,
    evidence: z.array(z.url()),
    limitations: z.array(z.string()),
    unconfirmed: z.array(z.string()),
    validation: z.object({ passed: z.literal(true), warnings: z.array(z.string()) }),
    next_step: z.union([AgentRole, z.literal("fim")]),
  });
}
export const AnyAgentOutputEnvelope = agentOutputEnvelope(z.unknown());
export type AgentOutputEnvelope = z.infer<typeof AnyAgentOutputEnvelope>;
