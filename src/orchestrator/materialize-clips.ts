import { ContentAnalysisResult } from "@/core/contracts/content";
import { SIMULATED_PROVIDERS } from "@/connectors/ai/ids";
import { json, type Sql } from "@/db/sql";
import type { ProjectRow, RunRow } from "./types";

/**
 * Ao concluir a análise de um material: grava os cortes candidatos (um por posição, idempotente) marcando se vieram
 * do modo de demonstração. A decisão sobre qual corte seguir é sempre do usuário.
 */
export async function materializeClipCandidates(
  tx: Sql,
  run: RunRow,
  project: ProjectRow,
  results: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const analysis = ContentAnalysisResult.parse(results.analista_conteudo);
  const mediaId = String(run.input.media_id);
  const [{ simulated }] = await tx.query<{ simulated: boolean }>(
    `select exists(select 1 from agent_tasks where run_id = $1 and provider = any($2::text[])) as simulated`,
    [run.id, `{${SIMULATED_PROVIDERS.join(",")}}`],
  );
  let inserted = 0;
  for (const [position, c] of analysis.candidates.entries()) {
    const rows = await tx.query<{ id: string }>(
      `insert into clip_candidates (media_id, project_id, owner_id, run_id, position, title, justification, start_s, end_s,
                                    segment_ids, score, score_reason, risks, simulated)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, $14)
       on conflict (run_id, position) do nothing
       returning id`,
      [
        mediaId,
        project.id,
        run.owner_id,
        run.id,
        position,
        c.title,
        c.justification,
        c.start_s,
        c.end_s,
        json(c.segment_ids),
        c.score.value,
        c.score.reason,
        json(c.risks),
        simulated,
      ],
    );
    inserted += rows.length;
  }
  return { media_id: mediaId, candidates: inserted, simulated };
}
