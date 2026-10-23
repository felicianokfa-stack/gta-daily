import type { AgentRole } from "@/core/contracts/common";

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  steps: AgentRole[];
}

/**
 * Pipelines adaptativos (seção 4): a sequência depende do objetivo da tarefa.
 * No Bloco B existe só o fluxo de pesquisa + verificação; os demais entram nos próximos blocos.
 */
const PIPELINES: Record<string, PipelineDefinition> = {
  pesquisa_verificacao: {
    id: "pesquisa_verificacao",
    name: "Pesquisa e verificação",
    description: "Reúne fontes sobre um tema e classifica cada alegação (fato, rumor, teoria…).",
    steps: ["pesquisador", "verificador"],
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
