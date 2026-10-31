import { AGENT_ROLES, type AgentRole } from "@/core/contracts/common";
import { analistaConteudo } from "./analista-conteudo";
import { pesquisador } from "./pesquisador";
import { verificador } from "./verificador";
import type { AnyAgentDefinition } from "./types";

const IMPLEMENTED: Partial<Record<AgentRole, AnyAgentDefinition>> = {
  pesquisador,
  verificador,
  analista_conteudo: analistaConteudo,
};

export function getAgent(role: AgentRole): AnyAgentDefinition {
  const agent = IMPLEMENTED[role];
  if (!agent) throw new Error(`Papel ainda não implementado: ${role}`);
  return agent;
}

/** Todos os papéis da especificação, com o estado de implementação. */
export function listAgentRoles(): { role: AgentRole; implemented: boolean; version?: string; description?: string }[] {
  return AGENT_ROLES.map((role) => {
    const agent = IMPLEMENTED[role];
    return { role, implemented: Boolean(agent), version: agent?.version, description: agent?.description };
  });
}
