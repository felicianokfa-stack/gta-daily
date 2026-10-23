import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/db/sql";
import { ClaudeProvider } from "@/connectors/claude";
import { ConnectorError } from "@/connectors/types";
import { ScriptedProvider, createGtaProject, createUser, orchestrator, setupDb } from "./helpers";

let sql: Sql;
let raw: PGlite;

beforeEach(async () => {
  ({ sql, raw } = await setupDb());
});

/** Executa como o papel `authenticated` do Supabase, com o JWT do usuário. */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await raw.exec(`set role authenticated`);
  await raw.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try {
    return await fn();
  } finally {
    await raw.exec(`reset role`);
  }
}

describe("RLS (acesso direto via Supabase com o token do usuário)", () => {
  it("cada usuário só lê os próprios projetos, execuções, tarefas e auditoria", async () => {
    const a = await createUser(sql);
    const b = await createUser(sql);
    const pa = await createGtaProject(sql, a);
    await createGtaProject(sql, b);
    await orchestrator(sql, new ScriptedProvider()).createRun({
      userId: a,
      projectId: pa.id,
      pipeline: "pesquisa_verificacao",
      input: { topic: "Tema de A" },
    });

    const seenByB = await asUser(b, async () => ({
      projects: (await raw.query(`select owner_id from content_projects`)).rows as { owner_id: string }[],
      runs: (await raw.query(`select id from pipeline_runs`)).rows,
      tasks: (await raw.query(`select id from agent_tasks`)).rows,
      audit: (await raw.query(`select id from audit_events`)).rows,
    }));
    expect(seenByB.projects).toHaveLength(1);
    expect(seenByB.projects[0].owner_id).toBe(b);
    expect(seenByB.runs).toHaveLength(0);
    expect(seenByB.tasks).toHaveLength(0);
    expect(seenByB.audit).toHaveLength(0);

    const seenByA = await asUser(a, async () => (await raw.query(`select id from agent_tasks`)).rows);
    expect(seenByA).toHaveLength(1);
  });

  it("o cliente não consegue forjar estado do pipeline nem criar projeto em nome de outro", async () => {
    const a = await createUser(sql);
    const b = await createUser(sql);
    const pa = await createGtaProject(sql, a);
    await asUser(a, async () => {
      await expect(
        raw.query(`insert into pipeline_runs (project_id, owner_id, pipeline, idempotency_key) values ($1, $2, 'x', 'k')`, [pa.id, a]),
      ).rejects.toThrow(/permission denied/);
      await expect(raw.query(`update agent_tasks set status = 'succeeded'`)).rejects.toThrow(/permission denied/);
      await expect(
        raw.query(`insert into content_projects (owner_id, name, niche) values ($1, 'X', 'gta-vi')`, [b]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("anônimo não lê nada", async () => {
    const a = await createUser(sql);
    await createGtaProject(sql, a);
    await raw.exec(`set role anon`);
    try {
      await expect(raw.query(`select * from content_projects`)).rejects.toThrow(/permission denied/);
    } finally {
      await raw.exec(`reset role`);
    }
  });
});

describe("conector Claude sem credencial", () => {
  it("não simula: falha com pending_credential não retentável", () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      let caught: unknown;
      try {
        new ClaudeProvider();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ConnectorError);
      expect((caught as ConnectorError).code).toBe("pending_credential");
      expect((caught as ConnectorError).retryable).toBe(false);
    } finally {
      if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });
});
