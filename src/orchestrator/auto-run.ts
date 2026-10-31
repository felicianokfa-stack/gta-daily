import type { Sql } from "@/db/sql";
import type { Orchestrator } from "./engine";
import { getDraftIdByRun } from "./queries";

export interface AutoRunResult {
  runId: string;
  status: string;
  /** Rascunho gerado (só no pipeline `producao_corte`, quando concluído). */
  draftId: string | null;
}

/**
 * Processa as tarefas da execução recém-criada na mesma chamada, para o usuário não precisar de um passo extra.
 * Nunca lança por falha de etapa: o estado fica na execução e a interface leva o usuário à página dela.
 */
export async function runAndSettle(
  orchestrator: Orchestrator,
  sql: Sql,
  userId: string,
  runId: string,
  maxSteps = 10,
): Promise<AutoRunResult> {
  try {
    await orchestrator.drain(maxSteps, { ownerId: userId });
  } catch (error) {
    console.error("auto-run: falha ao processar a fila", error);
  }
  const [row] = await sql.query<{ status: string }>(`select status::text as status from pipeline_runs where id = $1 and owner_id = $2`, [runId, userId]);
  const status = row?.status ?? "unknown";
  const draftId = status === "succeeded" ? await getDraftIdByRun(sql, userId, runId) : null;
  return { runId, status, draftId };
}
