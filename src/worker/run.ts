/**
 * Worker de longa duração: consome a fila agent_tasks continuamente.
 * Uso: DATABASE_URL=... ANTHROPIC_API_KEY=... npm run worker
 *
 * Pode haver vários workers ao mesmo tempo: a fila usa FOR UPDATE SKIP LOCKED + lease,
 * e uma tarefa abandonada (worker morto) é retomada quando o lease expira.
 */
import { createPostgresSql } from "@/db/postgres";
import { ClaudeProvider } from "@/connectors/claude";
import { Orchestrator } from "@/orchestrator/engine";

const IDLE_MS = Number(process.env.WORKER_IDLE_MS ?? 5000);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // O PGlite é de um processo só; no modo local use o botão "Processar minha fila agora".
    console.error("DATABASE_URL não configurada. O worker separado exige o Postgres do Supabase.");
    process.exit(1);
  }
  const sql = createPostgresSql(url);
  const orch = new Orchestrator({ sql, providerFactory: () => new ClaudeProvider() });
  let stopping = false;
  const stop = () => {
    console.log(`[${orch.workerId}] encerrando após a etapa atual…`);
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(`[${orch.workerId}] worker iniciado`);
  while (!stopping) {
    try {
      const r = await orch.processNext();
      if (r) {
        console.log(`[${orch.workerId}] tarefa ${r.taskId}: ${r.outcome}`);
        continue;
      }
    } catch (error) {
      console.error(`[${orch.workerId}] erro inesperado no ciclo`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }
  await sql.close();
}

void main();
