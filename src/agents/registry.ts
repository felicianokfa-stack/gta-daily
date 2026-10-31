import { AGENT_ROLES, type AgentRole } from "@/core/contracts/common";
import { analistaConteudo } from "./analista-conteudo";
import { distribuidor } from "./distribuidor";
import { estrategista } from "./estrategista";
import { pesquisador } from "./pesquisador";
import { produtorAudiovisual } from "./produtor-audiovisual";
import { revisorQualidade } from "./revisor-qualidade";
import { roteirista } from "./roteirista";
import { verificador } from "./verificador";
import type { AnyAgentDefinition } from "./types";

const IMPLEMENTED: Partial<Record<AgentRole, AnyAgentDefinition>> = {
  pesquisador,
  verificador,
  analista_conteudo: analistaConteudo,
  estrategista,
  roteirista,
  produtor_audiovisual: produtorAudiovisual,
  distribuidor,
  revisor_qualidade: revisorQualidade,
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
