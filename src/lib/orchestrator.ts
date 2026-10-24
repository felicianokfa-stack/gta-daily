import "server-only";
import { getDb } from "@/db";
import { createProviderFactory } from "@/connectors/ai/factory";
import { Orchestrator } from "@/orchestrator/engine";

export async function getOrchestrator(workerId = "app-server"): Promise<Orchestrator> {
  return new Orchestrator({ sql: await getDb(), providerFactory: createProviderFactory(), workerId });
}
