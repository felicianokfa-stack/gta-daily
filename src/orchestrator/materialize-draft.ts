import {
  ClipContext,
  Distribution,
  ProductionPlan,
  ReviewResult,
  ScriptResult,
  StrategyBrief,
} from "@/core/contracts/content";
import { SIMULATED_PROVIDERS } from "@/connectors/ai/ids";
import { json, type Sql } from "@/db/sql";
import { evaluateDraftGate } from "./draft-gate";
import type { ProjectRow, RunRow } from "./types";

/**
 * Ao concluir a produção de um corte: monta o rascunho (briefing, roteiro, plano de edição, versões por plataforma
 * e revisão), roda o portão determinístico e grava em `em_revisao`. Nada é aprovado nem publicado aqui: a decisão
 * é sempre humana. Idempotente por execução.
 */
export async function materializeDraft(
  tx: Sql,
  run: RunRow,
  project: ProjectRow,
  results: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ctx = ClipContext.parse(run.input);
  const brief = StrategyBrief.parse(results.estrategista);
  const script = ScriptResult.parse(results.roteirista);
  const plan = ProductionPlan.parse(results.produtor_audiovisual);
  const distribution = Distribution.parse(results.distribuidor);
  const review = ReviewResult.parse(results.revisor_qualidade);
  const gate = evaluateDraftGate(ctx, brief, script, plan, distribution, review);
  const [{ simulated }] = await tx.query<{ simulated: boolean }>(
    `select exists(select 1 from agent_tasks where run_id = $1 and provider = any($2::text[])) as simulated`,
    [run.id, `{${SIMULATED_PROVIDERS.join(",")}}`],
  );
  const rows = await tx.query<{ id: string }>(
    `insert into clip_drafts (clip_id, media_id, project_id, owner_id, run_id, brief, script, production_plan,
                              platform_versions, review, gate, simulated)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12)
     on conflict (run_id) do nothing
     returning id`,
    [
      ctx.clip_id,
      ctx.media_id,
      project.id,
      run.owner_id,
      run.id,
      json(brief),
      json(script),
      json(plan),
      json(distribution.versions),
      json(review),
      json(gate),
      simulated,
    ],
  );
  return { draft_id: rows[0]?.id ?? null, gate: gate.passed ? "aprovado" : "reprovado", reasons: gate.reasons, simulated };
}
