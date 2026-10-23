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
  settings: { max_attempts?: number; max_corrections?: number };
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
