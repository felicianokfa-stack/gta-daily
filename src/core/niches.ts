/**
 * Agentes de nicho fornecem contexto temático ao pipeline compartilhado (seção 2.1).
 * Eles não executam tarefas: o mesmo Pesquisador serve qualquer nicho com outro briefing.
 */
export interface NicheContext {
  id: string;
  name: string;
  description: string;
  default_audience: string;
  key_terms: string[];
  source_guidance: string[];
  editorial_rules: string[];
}

const GTA_VI: NicheContext = {
  id: "gta-vi",
  name: "GTA VI",
  description:
    "Grand Theft Auto VI e o universo GTA: anúncios, trailers, detalhes do jogo, comunidade, teorias e materiais relacionados.",
  default_audience: "Jogadores e fãs de GTA no Brasil, falantes de português.",
  key_terms: ["GTA VI", "GTA 6", "Rockstar Games", "Take-Two", "Vice City", "Leonida", "Jason", "Lucia", "GTA Online"],
  source_guidance: [
    "Priorize fontes primárias: Rockstar Games (Newswire), Take-Two (comunicados e relatórios a investidores), lojas oficiais das plataformas.",
    "Use veículos especializados reconhecidos como fontes secundárias e indique-os como tal.",
    "Vazamentos e perfis de rumores só podem aparecer classificados como rumor, nunca como fato.",
  ],
  editorial_rules: [
    "Diferencie fato confirmado, rumor, teoria, estimativa e hipótese.",
    "Não prometa viralização nem trate pontuações como probabilidades.",
    "Não use nem descreva material vazado como se fosse oficial.",
  ],
};

const NICHES: Record<string, NicheContext> = { [GTA_VI.id]: GTA_VI };

export function getNiche(id: string): NicheContext {
  const niche = NICHES[id];
  if (!niche) throw new Error(`Nicho desconhecido: ${id}`);
  return niche;
}

export function listNiches(): NicheContext[] {
  return Object.values(NICHES);
}
