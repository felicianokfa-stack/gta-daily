import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorError } from "@/connectors/types";
import type { Sql } from "@/db/sql";
import { InvalidStateError } from "@/orchestrator/engine";
import {
  SRC_A,
  SRC_B,
  ScriptedProvider,
  auditActions,
  createGtaProject,
  createUser,
  orchestrator,
  pendingCredential,
  researchResult,
  runStatus,
  setupDb,
  taskRows,
  verificationResult,
} from "./helpers";

let sql: Sql;
let userId: string;
let projectId: string;

beforeEach(async () => {
  ({ sql } = await setupDb());
  userId = await createUser(sql);
  projectId = (await createGtaProject(sql, userId)).id;
});

const input = { topic: "Data de lançamento do GTA VI", goal: "Post de notícia" };

describe("fluxo ponta a ponta", () => {
  it("cria, executa, valida e avança pesquisador → verificador até concluir", async () => {
    const provider = new ScriptedProvider()
      .ok(researchResult(), [SRC_A, SRC_B])
      .ok(verificationResult(), []);
    const orch = orchestrator(sql, provider);

    const { run, created } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    expect(created).toBe(true);
    expect(await runStatus(sql, run.id)).toBe("queued");

    expect((await orch.processNext())?.outcome).toBe("succeeded");
    let tasks = await taskRows(sql, run.id);
    expect(tasks.map((t) => [t.agent_role, t.status])).toEqual([
      ["pesquisador", "succeeded"],
      ["verificador", "queued"],
    ]);
    expect(await runStatus(sql, run.id)).toBe("running");

    expect((await orch.processNext())?.outcome).toBe("succeeded");
    expect(await orch.processNext()).toBeNull();
    tasks = await taskRows(sql, run.id);
    expect(tasks.every((t) => t.status === "succeeded")).toBe(true);
    expect(await runStatus(sql, run.id)).toBe("succeeded");

    // O verificador recebeu o resultado do pesquisador como entrada.
    const [, verifier] = await sql.query<{ input: { research: { topic: string } }; output: Record<string, unknown> }>(
      `select input, output from agent_tasks where run_id = $1 order by step_index`,
      [run.id],
    );
    expect(verifier.input.research.topic).toBe("Data de lançamento do GTA VI");
    // Envelope padrão montado pelo orquestrador.
    expect(verifier.output).toMatchObject({
      agent_role: "verificador",
      status: "completed",
      next_step: "fim",
      validation: { passed: true },
    });
    expect(await auditActions(sql, run.id)).toEqual([
      "run.created",
      "task.enqueued",
      "task.claimed",
      "task.succeeded",
      "task.enqueued",
      "task.claimed",
      "task.succeeded",
      "run.materialized",
      "run.succeeded",
    ]);
  });
});

describe("portão de validação", () => {
  it("rejeita fonte inventada, devolve com correções e aceita a versão corrigida", async () => {
    const invented = researchResult({
      sources: [{ url: "https://inventada.example/nao-existe", title: "Inventada", publisher: null, published_at: null }],
      claims_to_verify: [],
    });
    const provider = new ScriptedProvider().ok(invented, [SRC_A]).ok(researchResult(), [SRC_A, SRC_B]);
    const orch = orchestrator(sql, provider);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });

    expect((await orch.processNext())?.outcome).toBe("correction_requested");
    let [task] = await taskRows(sql, run.id);
    expect(task.status).toBe("queued");
    expect(task.corrections).toBe(1);
    expect((task.input.correction_notes as string[])[0]).toContain("possível URL inventada");

    expect((await orch.processNext())?.outcome).toBe("succeeded");
    [task] = await taskRows(sql, run.id);
    expect(task.status).toBe("succeeded");
    // A segunda chamada recebeu as correções no prompt.
    expect(provider.calls[1].prompt).toContain("correcoes_exigidas");
  });

  it("para em 'exige ação' depois do limite de correções, sem ciclo infinito", async () => {
    const bad = { topic: "x" }; // fora do contrato
    const provider = new ScriptedProvider().ok(bad).ok(bad).ok(bad).ok(bad);
    const orch = orchestrator(sql, provider);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });

    const outcomes = (await orch.drain()).map((r) => r.outcome);
    expect(outcomes).toEqual(["correction_requested", "correction_requested", "action_required"]);
    const [task] = await taskRows(sql, run.id);
    expect(task.status).toBe("failed_action_required");
    expect(await runStatus(sql, run.id)).toBe("failed_action_required");
    expect(provider.calls).toHaveLength(3);
  });

  it("não aceita 'fato confirmado' sem evidência", async () => {
    const provider = new ScriptedProvider()
      .ok(researchResult(), [SRC_A, SRC_B])
      .ok(verificationResult({ claims: [{ claim: "O jogo tem data anunciada.", label: "fato_confirmado", confidence: "alta", evidence_urls: [], notes: "" }] }))
      .ok(verificationResult());
    const orch = orchestrator(sql, provider);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    const outcomes = (await orch.drain()).map((r) => r.outcome);
    expect(outcomes).toEqual(["succeeded", "correction_requested", "succeeded"]);
    expect(await runStatus(sql, run.id)).toBe("succeeded");
  });
});

describe("falhas de conector", () => {
  it("credencial ausente vira 'exige ação' (não retenta à toa) e pode ser retentada depois", async () => {
    let provider: ScriptedProvider | null = null;
    const orch = orchestrator(sql, () => {
      if (!provider) throw pendingCredential();
      return provider;
    });
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });

    expect((await orch.processNext())?.outcome).toBe("action_required");
    let [task] = await taskRows(sql, run.id);
    expect(task.status).toBe("failed_action_required");
    expect(task.error).toMatchObject({ code: "pending_credential" });
    expect(await orch.processNext()).toBeNull();

    // Usuário configura a credencial e pede nova tentativa.
    provider = new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]);
    await orch.retryTask(userId, task.id);
    expect((await orch.processNext())?.outcome).toBe("succeeded");
    [task] = await taskRows(sql, run.id);
    expect(task.status).toBe("succeeded");
  });

  it("erro temporário agenda retentativa com backoff e depois conclui", async () => {
    const provider = new ScriptedProvider()
      .fail(new ConnectorError("rate_limited", "429", true))
      .ok(researchResult(), [SRC_A, SRC_B]);
    const orch = orchestrator(sql, provider);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });

    expect((await orch.processNext())?.outcome).toBe("retry_scheduled");
    let [task] = await taskRows(sql, run.id);
    expect(task.status).toBe("failed_retryable");
    // Backoff: não está pronta ainda.
    expect(await orch.processNext()).toBeNull();
    await sql.query(`update agent_tasks set not_before = now() where id = $1`, [task.id]);
    expect((await orch.processNext())?.outcome).toBe("succeeded");
    [task] = await taskRows(sql, run.id);
    expect(task.attempts).toBe(2);
  });
});

describe("recuperação e retomada", () => {
  it("worker que morreu: lease expira e outro worker retoma; o resultado tardio do primeiro é descartado", async () => {
    const provider = new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]);
    const orchA = orchestrator(sql, provider, "worker-A");
    const orchB = orchestrator(sql, provider, "worker-B");
    const { run } = await orchA.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });

    // Worker A reserva a tarefa e "morre" (simulado reservando direto no banco).
    await sql.query(
      `update agent_tasks set status = 'running', attempts = 1, lease_owner = 'worker-A',
              lease_expires_at = now() - interval '1 second' where run_id = $1`,
      [run.id],
    );
    const result = await orchB.processNext();
    expect(result?.outcome).toBe("succeeded");
    const [task] = await taskRows(sql, run.id);
    expect(task.attempts).toBe(2);
    expect(task.status).toBe("succeeded");

    // Uma escrita tardia do worker A não sobrescreve o estado (guarda por lease_owner).
    const late = await sql.query(
      `update agent_tasks set status = 'failed_retryable' where id = $1 and lease_owner = 'worker-A' and status = 'running' returning id`,
      [task.id],
    );
    expect(late).toHaveLength(0);
  });

  it("estado persiste: um novo orquestrador (outro processo) continua a execução", async () => {
    const provider = new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]).ok(verificationResult());
    const { run } = await orchestrator(sql, provider).createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orchestrator(sql, provider, "w1").processNext();
    await orchestrator(sql, provider, "w2").processNext();
    expect(await runStatus(sql, run.id)).toBe("succeeded");
  });
});

describe("idempotência, reaproveitamento e cancelamento", () => {
  it("mesma chave de idempotência devolve a mesma execução, sem duplicar tarefas", async () => {
    const orch = orchestrator(sql, new ScriptedProvider());
    const a = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input, idempotencyKey: "k1" });
    const b = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input, idempotencyKey: "k1" });
    expect(b.created).toBe(false);
    expect(b.run.id).toBe(a.run.id);
    expect(await taskRows(sql, a.run.id)).toHaveLength(1);
  });

  it("reaproveita resultado válido com a mesma entrada, sem chamar o modelo de novo", async () => {
    const provider = new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]).ok(verificationResult());
    const orch = orchestrator(sql, provider);
    await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.drain();
    expect(provider.calls).toHaveLength(2);

    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    const outcomes = (await orch.drain()).map((r) => r.outcome);
    expect(outcomes).toEqual(["reused", "reused"]);
    expect(provider.calls).toHaveLength(2);
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const tasks = await taskRows(sql, run.id);
    expect(tasks.every((t) => t.reused_from)).toBe(true);
  });

  it("não reaproveita resultado com mais de 24 h (o nicho é de notícias)", async () => {
    const provider = new ScriptedProvider()
      .ok(researchResult(), [SRC_A, SRC_B])
      .ok(verificationResult())
      .ok(researchResult(), [SRC_A, SRC_B])
      .ok(verificationResult());
    const orch = orchestrator(sql, provider);
    await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.drain();
    await sql.query(`update agent_tasks set finished_at = now() - interval '25 hours'`);

    await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    expect((await orch.drain()).map((r) => r.outcome)).toEqual(["succeeded", "succeeded"]);
    expect(provider.calls).toHaveLength(4);
  });

  it("cancelamento interrompe a execução e a fila ignora as tarefas pendentes", async () => {
    const provider = new ScriptedProvider();
    const orch = orchestrator(sql, provider);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.cancelRun(userId, run.id);
    expect(await runStatus(sql, run.id)).toBe("cancelled");
    expect(await orch.processNext()).toBeNull();
    expect(provider.calls).toHaveLength(0);
    await expect(orch.cancelRun(userId, run.id)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("cancelar durante a execução de um agente não enfileira a próxima etapa", async () => {
    const orch = orchestrator(sql, () => provider);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    const provider = {
      id: "cancela-no-meio",
      async generateStructured() {
        await orch.cancelRun(userId, run.id);
        return { data: researchResult(), retrievedSources: [SRC_A, SRC_B], usage: [] };
      },
    };
    await orch.processNext();
    const tasks = await taskRows(sql, run.id);
    expect(tasks).toHaveLength(1);
    expect(await runStatus(sql, run.id)).toBe("cancelled");
  });
});

describe("isolamento entre usuários", () => {
  it("processar a fila pela interface só toca as tarefas do próprio usuário", async () => {
    const other = await createUser(sql);
    const otherProject = await createGtaProject(sql, other);
    const provider = new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]);
    const orch = orchestrator(sql, provider);
    const { run: otherRun } = await orch.createRun({ userId: other, projectId: otherProject.id, pipeline: "pesquisa_verificacao", input });
    const { run: mine } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input: { topic: "Outro tema" } });

    expect(await orch.processNext({ ownerId: userId })).not.toBeNull();
    expect((await taskRows(sql, mine.id))[0].status).toBe("succeeded");
    expect((await taskRows(sql, otherRun.id))[0].status).toBe("queued");
  });

  it("um usuário não cria execução nem cancela em projeto de outro", async () => {
    const other = await createUser(sql);
    const orch = orchestrator(sql, new ScriptedProvider());
    await expect(orch.createRun({ userId: other, projectId, pipeline: "pesquisa_verificacao", input })).rejects.toThrow("Projeto não encontrado");
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await expect(orch.cancelRun(other, run.id)).rejects.toThrow("Execução não encontrada");
  });
});
