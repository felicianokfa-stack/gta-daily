import type { AgentRole } from "@/core/contracts/common";
import type { Sql } from "@/db/sql";
import { InvalidStateError, NotFoundError } from "./errors";
import { materializeOpportunity } from "./materialize";
import { materializeClipCandidates } from "./materialize-clips";
import type { MediaRow, ProjectRow, RunRow } from "./types";

const KNOWN_SOURCES_LIMIT = 20;

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  steps: AgentRole[];
  /** Monta a entrada da execução a partir do projeto e dos dados informados pelo usuário. */
  buildRunInput: (sql: Sql, project: ProjectRow, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /**
   * Executado na transação que conclui a execução, com os resultados validados de cada etapa.
   * Devolve um resumo para a auditoria.
   */
  onSucceeded?: (tx: Sql, run: RunRow, project: ProjectRow, results: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/** Pesquisa: injeta o nicho e as fontes já registradas no projeto (o Pesquisador prioriza o que é novo). */
async function researchRunInput(sql: Sql, project: ProjectRow, input: Record<string, unknown>) {
  const knownSources = await sql.query<{ url: string; title: string }>(
    `select url, title from source_records where project_id = $1 order by updated_at desc limit ${KNOWN_SOURCES_LIMIT}`,
    [project.id],
  );
  return { ...input, niche_id: project.niche, known_sources: knownSources };
}

/** Análise de mídia: carrega o material do próprio projeto/dono e exige a autorização declarada. */
async function mediaRunInput(sql: Sql, project: ProjectRow, input: Record<string, unknown>) {
  const mediaId = String(input.media_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new NotFoundError("Escolha um material da biblioteca.");
  const [media] = await sql.query<MediaRow>(
    `select * from media_items where id = $1 and project_id = $2 and owner_id = $3`,
    [mediaId, project.id, project.owner_id],
  );
  if (!media) throw new NotFoundError("Material não encontrado neste projeto.");
  if (media.usage_rights?.declared !== true) {
    throw new InvalidStateError("Este material não tem a declaração de autorização: não pode ser analisado.");
  }
  return {
    media_id: media.id,
    title: media.title,
    kind: media.kind,
    is_sample: media.is_sample,
    duration_seconds: media.duration_seconds,
    metadata: media.metadata,
    transcript: media.transcript,
    niche_id: project.niche,
    goal: typeof input.goal === "string" ? input.goal : "",
  };
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
    buildRunInput: researchRunInput,
    onSucceeded: materializeOpportunity,
  },
  analise_midia: {
    id: "analise_midia",
    name: "Análise de material",
    description: "Lê a transcrição de um material da biblioteca e sugere cortes com tempos, justificativa e pontuação editorial.",
    steps: ["analista_conteudo"],
    buildRunInput: mediaRunInput,
    onSucceeded: materializeClipCandidates,
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
