import type { PipelineStatus, TaskStatus } from "@/core/contracts/common";
import type { ConnectorState } from "@/connectors/types";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const TASK_STATUS: Record<TaskStatus, { label: string; help: string; tone: Tone }> = {
  queued: { label: "Na fila", help: "Aguardando um worker livre.", tone: "neutral" },
  running: { label: "Em execução", help: "Um agente está trabalhando nesta etapa.", tone: "info" },
  waiting_input: { label: "Aguardando você", help: "Esta etapa depende de uma informação sua.", tone: "warning" },
  succeeded: { label: "Concluída", help: "Saída validada pelo orquestrador.", tone: "success" },
  failed_retryable: { label: "Falha recuperável", help: "Erro temporário; nova tentativa agendada automaticamente.", tone: "warning" },
  failed_action_required: { label: "Exige ação", help: "Não dá para continuar sozinho. Veja o motivo e a ação sugerida.", tone: "danger" },
  cancelled: { label: "Cancelada", help: "Interrompida sem continuar o fluxo.", tone: "neutral" },
};

export const RUN_STATUS: Record<PipelineStatus, { label: string; tone: Tone }> = {
  queued: { label: "Na fila", tone: "neutral" },
  running: { label: "Em andamento", tone: "info" },
  waiting_input: { label: "Aguardando você", tone: "warning" },
  succeeded: { label: "Concluída", tone: "success" },
  failed_action_required: { label: "Exige ação", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const CONNECTOR_STATE: Record<ConnectorState, { label: string; tone: Tone }> = {
  connected: { label: "Conectado", tone: "success" },
  credential_present: { label: "Credencial presente", tone: "info" },
  pending_credential: { label: "Falta credencial", tone: "warning" },
  needs_validation: { label: "Precisa validar", tone: "neutral" },
  not_supported: { label: "Não suportado", tone: "danger" },
};

export const ROLE_LABEL: Record<string, string> = {
  pesquisador: "Pesquisador",
  verificador: "Verificador",
  analista_conteudo: "Analista de conteúdo",
  estrategista: "Estrategista",
  roteirista: "Roteirista",
  produtor_audiovisual: "Produtor audiovisual",
  revisor_qualidade: "Revisor de qualidade",
  distribuidor: "Distribuidor",
  analista_desempenho: "Analista de desempenho",
};

/** Ação sugerida ao usuário para cada código de erro conhecido. */
export const ERROR_ACTION: Record<string, string> = {
  pending_credential: "Configure ANTHROPIC_API_KEY no servidor/worker e clique em “Tentar de novo”.",
  authentication: "A credencial foi recusada. Confira a chave da Anthropic e tente de novo.",
  validation_failed: "O agente não conseguiu produzir uma saída válida. Revise o tema (mais específico) e tente de novo.",
  attempts_exhausted: "Muitas tentativas sem sucesso. Verifique os conectores e tente de novo.",
  refusal: "O modelo recusou a tarefa. Reformule o tema.",
  bad_request: "Requisição rejeitada pelo provedor. Veja o detalhe técnico.",
  invalid_input: "A entrada desta etapa está fora do contrato. Crie uma nova execução.",
  budget_exceeded: "O orçamento mensal do projeto foi atingido. Aumente o orçamento em Projetos (ou aguarde o próximo mês) e clique em “Tentar de novo”.",
  advance_failed: "A etapa foi salva, mas o avanço do pipeline falhou. Veja o detalhe técnico e crie uma nova execução.",
};

export const PLATFORM_LABEL: Record<string, string> = {
  instagram_reels: "Instagram Reels",
  instagram_carrossel: "Instagram Carrossel/Fotos",
  tiktok: "TikTok",
  youtube_shorts: "YouTube Shorts",
};

export const AUDIT_LABEL: Record<string, string> = {
  "run.created": "Execução criada",
  "run.succeeded": "Execução concluída",
  "run.cancelled": "Execução cancelada",
  "task.enqueued": "Etapa enfileirada",
  "task.claimed": "Worker assumiu a etapa",
  "task.succeeded": "Saída validada",
  "task.reused": "Resultado anterior reaproveitado",
  "task.validation_failed": "Saída rejeitada pela validação",
  "task.retry_scheduled": "Nova tentativa agendada",
  "task.error": "Erro do conector",
  "task.action_required": "Exige ação",
  "task.retry_requested": "Nova tentativa solicitada",
  "task.lease_lost": "Lease perdido (resultado descartado)",
  "run.materialized": "Fontes e oportunidade registradas",
  "run.advance_failed": "Falha ao avançar o pipeline",
  "opportunity.decided": "Decisão sobre a oportunidade",
};

export const OPPORTUNITY_STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  pronta_para_estrategia: { label: "Pronta para estratégia", tone: "success", help: "Passou no portão de qualidade (ou foi liberada por você)." },
  nova: { label: "Precisa de mais verificação", tone: "warning", help: "Não passou no portão de qualidade. Veja os motivos." },
  descartada: { label: "Descartada", tone: "neutral", help: "Você decidiu não seguir com este tema." },
};

export const VERIFICATION_STATE: Record<string, { label: string; tone: Tone }> = {
  verificada: { label: "Verificada", tone: "success" },
  parcial: { label: "Parcialmente verificada", tone: "warning" },
  nao_verificada: { label: "Não verificada", tone: "danger" },
};

export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  alta: { label: "Prioridade alta", tone: "info" },
  media: { label: "Prioridade média", tone: "neutral" },
  baixa: { label: "Prioridade baixa", tone: "neutral" },
};

export const EVIDENCE_LABEL: Record<string, { label: string; tone: Tone }> = {
  fato_confirmado: { label: "Fato confirmado", tone: "success" },
  rumor: { label: "Rumor", tone: "warning" },
  teoria: { label: "Teoria", tone: "warning" },
  estimativa: { label: "Estimativa", tone: "info" },
  hipotese: { label: "Hipótese", tone: "info" },
  nao_verificado: { label: "Não verificado", tone: "danger" },
};

export const GATE_RULE: Record<string, string> = {
  rastreabilidade: "Fontes rastreáveis",
  evidencia_suficiente: "Evidência suficiente",
  contradicoes_explicadas: "Contradições explicadas",
};
