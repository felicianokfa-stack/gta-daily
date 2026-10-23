import "server-only";
import { getDb } from "@/db";
import { ClaudeProvider } from "@/connectors/claude";
import { Orchestrator } from "@/orchestrator/engine";

export async function getOrchestrator(workerId = "app-server"): Promise<Orchestrator> {
  return new Orchestrator({ sql: await getDb(), providerFactory: () => new ClaudeProvider(), workerId });
}
