import type { AgentRole } from "@/core/contracts/common";
import type { Sql } from "@/db/sql";
import { materializeOpportunity } from "./materialize";
import type { ProjectRow, RunRow } from "./types";

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  steps: AgentRole[];
  /**
   * Executado na transação que conclui a execução, com os resultados validados de cada etapa.
   * Devolve um resumo para a auditoria.
   */
  onSucceeded?: (tx: Sql, run: RunRow, project: ProjectRow, results: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * Pipelines adaptativos (seção 4): a sequência depende do objetivo da tarefa.
 * Por enquanto existe o fluxo de pesquisa + verificação, que gera fontes e oportunidades (Bloco C).
 */
const PIPELINES: Record<string, PipelineDefinition> = {
  pesquisa_verificacao: {
    id: "pesquisa_verificacao",
    name: "Pesquisa e verificação",
    description: "Reúne fontes sobre um tema e classifica cada alegação (fato, rumor, teoria…).",
    steps: ["pesquisador", "verificador"],
    onSucceeded: materializeOpportunity,
  },
};

export function getPipeline(id: string): PipelineDefinition {
  const p = PIPELINES[id];
  if (!p) throw new Error(`Pipeline desconhecido: ${id}`);
  return p;
}

export function listPipelines(): PipelineDefinition[] {
  return Object.values(PIPELINES);
}
