import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createPgliteSql } from "@/db/pglite";
import { migrateLocal } from "@/db/migrate";
import type { Sql } from "@/db/sql";
import { ConnectorError, type ModelProvider, type RetrievedSource, type StructuredRequest, type StructuredResponse } from "@/connectors/types";
import { Orchestrator } from "@/orchestrator/engine";
import { createProject } from "@/orchestrator/queries";

export async function setupDb(): Promise<{ sql: Sql; raw: PGlite }> {
  const db = await createPgliteSql();
  await migrateLocal(db.sql);
  return db;
}

export async function createUser(sql: Sql, email = `${randomUUID()}@teste.local`): Promise<string> {
  const id = randomUUID();
  await sql.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return id;
}

export async function createGtaProject(sql: Sql, userId: string, settings?: Record<string, number>) {
  const project = await createProject(sql, userId, { name: "GTA DAILY", niche: "gta-vi", platforms: ["instagram_reels"] });
  if (settings) {
    await sql.query(`update content_projects set settings = $2::jsonb where id = $1`, [project.id, JSON.stringify(settings)]);
  }
  return project;
}

type Step =
  | { kind: "ok"; data: unknown; sources: RetrievedSource[] }
  | { kind: "error"; error: Error };

/**
 * TEST DOUBLE do provedor de modelo — existe apenas nos testes.
 * Devolve respostas roteirizadas em ordem para exercitar o orquestrador sem chamar a API real.
 */
export class ScriptedProvider implements ModelProvider {
  readonly id = "scripted-test-double";
  readonly calls: StructuredRequest<unknown>[] = [];
  private readonly steps: Step[] = [];

  ok(data: unknown, sources: RetrievedSource[] = []): this {
    this.steps.push({ kind: "ok", data, sources });
    return this;
  }
  fail(error: Error): this {
    this.steps.push({ kind: "error", error });
    return this;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse> {
    this.calls.push(request as StructuredRequest<unknown>);
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedProvider: nenhuma resposta roteirizada restante");
    if (step.kind === "error") throw step.error;
    return {
      data: step.data,
      retrievedSources: step.sources,
      usage: [{ model: "test-double", input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, web_search_requests: 1 }],
    };
  }
}

export function orchestrator(sql: Sql, provider: ModelProvider | (() => ModelProvider), workerId?: string) {
  return new Orchestrator({
    sql,
    providerFactory: typeof provider === "function" ? provider : () => provider,
    workerId,
  });
}

export const SRC_A: RetrievedSource = {
  url: "https://www.rockstargames.com/newswire/article/exemplo",
  title: "Rockstar Newswire — exemplo",
  page_age: null,
};
export const SRC_B: RetrievedSource = { url: "https://exemplo-especializado.com/gta6", title: "Site especializado", page_age: "2 dias" };

export function researchResult(overrides: Record<string, unknown> = {}) {
  return {
    topic: "Data de lançamento do GTA VI",
    summary: "Resumo de teste.",
    sources: [
      { url: SRC_A.url, title: SRC_A.title, publisher: "Rockstar Games", published_at: null },
      { url: SRC_B.url, title: SRC_B.title, publisher: null, published_at: null },
    ],
    claims_to_verify: [
      { claim: "O jogo tem data anunciada.", source_urls: [SRC_A.url], initial_label: "fato_confirmado" },
      { claim: "Haverá versão de PC no lançamento.", source_urls: [SRC_B.url], initial_label: "rumor" },
    ],
    unknowns: ["Data da versão de PC."],
    ...overrides,
  };
}

export function verificationResult(overrides: Record<string, unknown> = {}) {
  return {
    claims: [
      { claim: "O jogo tem data anunciada.", label: "fato_confirmado", confidence: "alta", evidence_urls: [SRC_A.url], notes: "Fonte primária." },
      { claim: "Haverá versão de PC no lançamento.", label: "rumor", confidence: "baixa", evidence_urls: [SRC_B.url], notes: "Só fonte secundária." },
    ],
    contradictions: [],
    caveats: ["Informações podem mudar."],
    overall: "Data confirmada; PC é rumor.",
    ...overrides,
  };
}

export async function taskRows(sql: Sql, runId: string) {
  return sql.query<{ id: string; agent_role: string; status: string; attempts: number; corrections: number; reused_from: string | null; error: unknown; input: Record<string, unknown> }>(
    `select * from agent_tasks where run_id = $1 order by step_index, created_at`,
    [runId],
  );
}

export async function runStatus(sql: Sql, runId: string): Promise<string> {
  const [r] = await sql.query<{ status: string }>(`select status from pipeline_runs where id = $1`, [runId]);
  return r.status;
}

export async function auditActions(sql: Sql, runId: string): Promise<string[]> {
  const rows = await sql.query<{ action: string }>(`select action from audit_events where run_id = $1 order by id`, [runId]);
  return rows.map((r) => r.action);
}

export const pendingCredential = () =>
  new ConnectorError("pending_credential", "Claude sem credencial: configure ANTHROPIC_API_KEY no servidor/worker.", false);
