import type { z } from "zod";
import type { AgentRole } from "@/core/contracts/common";
import type { NicheContext } from "@/core/niches";
import type { ModelProvider, ModelUsage, RetrievedSource } from "@/connectors/types";

export interface ProjectContext {
  id: string;
  name: string;
  audience: string;
  language: string;
  platforms: string[];
  editorial_rules: Record<string, unknown>;
}

export interface AgentRunContext {
  project: ProjectContext;
  niche: NicheContext;
  provider: ModelProvider;
}

export interface AgentRunOutput {
  raw: unknown;
  retrievedSources: RetrievedSource[];
  usage: ModelUsage[];
}

/** Resultado da validação de negócio feita pelo orquestrador além do schema. */
export interface BusinessValidation {
  errors: string[];
  warnings: string[];
  evidence: string[];
  limitations: string[];
  unconfirmed: string[];
}

/**
 * Um papel lógico com contrato próprio (seção 3): instruções, entrada, saída e validações separadas.
 * O mesmo modelo pode servir vários papéis.
 */
export interface AgentDefinition<I, R> {
  role: AgentRole;
  version: string;
  description: string;
  inputSchema: z.ZodType<I>;
  resultSchema: z.ZodType<R>;
  /** Monta a entrada desta etapa a partir da entrada da execução e dos resultados anteriores. */
  buildInput(runInput: Record<string, unknown>, previousResults: Partial<Record<AgentRole, unknown>>): I;
  run(input: I, ctx: AgentRunContext): Promise<AgentRunOutput>;
  validate(input: I, result: R, retrieved: RetrievedSource[]): BusinessValidation;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentDefinition = AgentDefinition<any, any>;
