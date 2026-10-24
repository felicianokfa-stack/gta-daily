import { ResearchResult, VerificationResult } from "@/core/contracts/research";
import { getNiche } from "@/core/niches";
import { SIMULATED_PROVIDERS } from "@/connectors/ai/ids";
import { json, type Sql } from "@/db/sql";
import { evaluateQualityGate, isPrimarySource, suggestedPriority, verificationState } from "./quality-gate";
import type { ProjectRow, RunRow } from "./types";

/**
 * Ao concluir pesquisa + verificação: registra as fontes do projeto e cria a oportunidade
 * com o resultado do portão de qualidade. Roda na mesma transação que encerra a execução
 * e é idempotente (fonte única por projeto+URL, oportunidade única por execução).
 */
export async function materializeOpportunity(
  tx: Sql,
  run: RunRow,
  project: ProjectRow,
  results: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const research = ResearchResult.parse(results.pesquisador);
  const verification = VerificationResult.parse(results.verificador);
  const niche = getNiche(project.niche);

  const sources = new Map([...research.sources, ...verification.additional_sources].map((s) => [s.url, s]));
  // Execução simulada (modo de demonstração): fontes e fatos são fictícios e não entram na base de fontes reais.
  const [{ simulated }] = await tx.query<{ simulated: boolean }>(
    `select exists(select 1 from agent_tasks where run_id = $1 and provider = any($2::text[])) as simulated`,
    [run.id, `{${SIMULATED_PROVIDERS.join(",")}}`],
  );
  for (const s of simulated ? [] : sources.values()) {
    await tx.query(
      `insert into source_records (project_id, owner_id, url, title, publisher, published_at, kind, first_seen_run, last_seen_run)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       on conflict (project_id, url) do update
         set title = excluded.title,
             publisher = coalesce(excluded.publisher, source_records.publisher),
             published_at = coalesce(excluded.published_at, source_records.published_at),
             last_seen_run = excluded.last_seen_run,
             times_seen = source_records.times_seen + case when source_records.last_seen_run = excluded.last_seen_run then 0 else 1 end,
             updated_at = now()`,
      [
        project.id,
        run.owner_id,
        s.url,
        s.title,
        s.publisher,
        s.published_at,
        isPrimarySource(s.url, niche) ? "primaria" : "secundaria",
        run.id,
      ],
    );
  }

  const gate = evaluateQualityGate(research, verification, niche);
  const state = verificationState(verification);
  const rows = await tx.query<{ id: string }>(
    `insert into opportunities (project_id, owner_id, run_id, topic, summary, verification_state, relevance, relevance_reason,
                                priority, claims, contradictions, caveats, source_urls, quality_gate, status, simulated)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb,
             array(select jsonb_array_elements_text($13::jsonb)), $14::jsonb, $15, $16)
     on conflict (run_id) do nothing
     returning id`,
    [
      project.id,
      run.owner_id,
      run.id,
      research.topic,
      `${research.summary}\n\nAvaliação do Verificador: ${verification.overall}`,
      state,
      research.relevance.score,
      research.relevance.reason,
      suggestedPriority(gate.passed, research.relevance.score),
      json(verification.claims),
      json(verification.contradictions),
      json(verification.caveats),
      json([...sources.keys()]),
      json(gate),
      gate.passed ? "pronta_para_estrategia" : "nova",
      simulated,
    ],
  );
  return {
    opportunity_id: rows[0]?.id ?? null,
    simulated,
    sources: simulated ? 0 : sources.size,
    quality_gate: gate.passed ? "aprovada" : "reprovada",
    reasons: gate.reasons,
  };
}
