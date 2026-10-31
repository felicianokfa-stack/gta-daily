import type { AgentRole, PipelineStatus, TaskStatus } from "@/core/contracts/common";

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  niche: string;
  audience: string;
  language: string;
  platforms: string[];
  editorial_rules: Record<string, unknown>;
  settings: { max_attempts?: number; max_corrections?: number; monthly_budget_usd?: number; ai_provider?: string };
  created_at: Date;
}

export interface RunRow {
  id: string;
  project_id: string;
  owner_id: string;
  pipeline: string;
  goal: string;
  input: Record<string, unknown>;
  status: PipelineStatus;
  current_step: number;
  idempotency_key: string;
  error: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

export interface TaskRow {
  id: string;
  run_id: string;
  project_id: string;
  owner_id: string;
  step_index: number;
  agent_role: AgentRole;
  agent_version: string;
  input: Record<string, unknown>;
  input_hash: string;
  output: Record<string, unknown> | null;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  corrections: number;
  max_corrections: number;
  validation: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  reused_from: string | null;
  not_before: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  usage: unknown;
  /** Provedor de IA que atendeu a tarefa (rastreabilidade). null em tarefas anteriores ao Bloco de provedores. */
  provider: string | null;
  cost_usd: string;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  data: Record<string, unknown>;
  task_id: string | null;
  created_at: Date;
}

export type ProcessOutcome =
  | "succeeded"
  | "reused"
  | "correction_requested"
  | "retry_scheduled"
  | "action_required"
  | "cancelled"
  | "lease_lost";

export interface OpportunityRow {
  id: string;
  project_id: string;
  owner_id: string;
  run_id: string;
  topic: string;
  summary: string;
  verification_state: "verificada" | "parcial" | "nao_verificada";
  relevance: number;
  relevance_reason: string;
  priority: "alta" | "media" | "baixa";
  claims: { claim: string; label: string; confidence: string; evidence_urls: string[]; notes: string }[];
  contradictions: string[];
  caveats: string[];
  source_urls: string[];
  quality_gate: { passed: boolean; reasons: string[]; checks: { rule: string; passed: boolean; detail: string }[] };
  status: "nova" | "pronta_para_estrategia" | "descartada";
  /** true quando veio do modo de demonstração: dados fictícios, nunca fatos ou fontes reais. */
  simulated: boolean;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SourceRecordRow {
  id: string;
  project_id: string;
  url: string;
  title: string;
  publisher: string | null;
  published_at: string | null;
  kind: "primaria" | "secundaria";
  times_seen: number;
  created_at: Date;
  updated_at: Date;
}

export interface MediaRow {
  id: string;
  project_id: string;
  owner_id: string;
  kind: "link" | "transcricao" | "exemplo";
  title: string;
  url: string | null;
  duration_seconds: number;
  metadata: Record<string, unknown>;
  transcript: { id: number; start_s: number; end_s: number; text: string }[];
  usage_rights: { declared: boolean; basis: string };
  is_sample: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ClipCandidateRow {
  id: string;
  media_id: string;
  project_id: string;
  owner_id: string;
  run_id: string;
  position: number;
  title: string;
  justification: string;
  start_s: string;
  end_s: string;
  segment_ids: number[];
  score: number;
  score_reason: string;
  risks: string[];
  status: "sugerido" | "selecionado" | "descartado";
  simulated: boolean;
  created_at: Date;
  updated_at: Date;
}
