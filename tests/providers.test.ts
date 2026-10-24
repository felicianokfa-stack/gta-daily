import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProviderFactory, resolveProviderId } from "@/connectors/ai/factory";
import { GeminiProvider, resetGeminiRateLimiter, testGeminiConnection } from "@/connectors/ai/gemini";
import { MockProvider } from "@/connectors/ai/mock";
import { OllamaProvider, testOllamaConnection } from "@/connectors/ai/ollama";
import { describeProviders } from "@/connectors/ai/status";
import { listConnectors } from "@/connectors/registry";
import { ConnectorError, type StructuredRequest } from "@/connectors/types";
import { ResearchResult, VerificationResult } from "@/core/contracts/research";
import type { Sql } from "@/db/sql";
import { Orchestrator } from "@/orchestrator/engine";
import {
  SRC_A,
  ScriptedProvider,
  auditActions,
  createGtaProject,
  createUser,
  orchestrator,
  researchResult,
  runStatus,
  setupDb,
  taskRows,
  verificationResult,
} from "./helpers";

const ENV_KEYS = [
  "AI_PROVIDER",
  "MOCK_SCENARIO",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_GROUNDING",
  "OLLAMA_MODEL",
  "OLLAMA_BASE_URL",
  "YOUTUBE_API_KEY",
];
let savedEnv: Record<string, string | undefined>;
let sql: Sql;
let userId: string;
let projectId: string;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetGeminiRateLimiter();
  ({ sql } = await setupDb());
  userId = await createUser(sql);
  projectId = (await createGtaProject(sql, userId)).id;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const input = { topic: "Data de lançamento do GTA VI", goal: "Post de notícia" };

function envOrchestrator() {
  return new Orchestrator({ sql, providerFactory: createProviderFactory(), workerId: "teste" });
}

async function runPipeline(orch: Orchestrator) {
  const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
  await orch.drain(10);
  return run;
}

async function opportunityOf(runId: string) {
  const [o] = await sql.query<{ simulated: boolean; status: string; quality_gate: { passed: boolean; reasons: string[] }; source_urls: string[]; summary: string }>(
    `select * from opportunities where run_id = $1`,
    [runId],
  );
  return o;
}

describe("sem ANTHROPIC_API_KEY e modo de demonstração", () => {
  it("sem nenhum provedor escolhido, o app não simula: etapa exige ação (pending_credential)", async () => {
    const run = await runPipeline(envOrchestrator());
    expect(await runStatus(sql, run.id)).toBe("failed_action_required");
    const [task] = await taskRows(sql, run.id);
    expect(task.error).toMatchObject({ code: "pending_credential" });
    expect(String((task.error as { message: string }).message)).toMatch(/AI_PROVIDER|Configurações/);
  });

  it("AI_PROVIDER=mock roda o pipeline inteiro sem nenhuma chave da Anthropic", async () => {
    process.env.AI_PROVIDER = "mock";
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const run = await runPipeline(envOrchestrator());
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const tasks = await sql.query<{ agent_role: string; status: string; provider: string; cost_usd: string; usage: { provider: string }[]; output: { result: unknown } }>(
      `select agent_role, status, provider, cost_usd, usage, output from agent_tasks where run_id = $1 order by step_index`,
      [run.id],
    );
    expect(tasks.map((t) => [t.agent_role, t.status, t.provider])).toEqual([
      ["pesquisador", "succeeded", "mock"],
      ["verificador", "succeeded", "mock"],
    ]);
    // Contratos de saída respeitados e custo zero, com o provedor registrado no uso.
    expect(ResearchResult.safeParse(tasks[0].output.result).success).toBe(true);
    expect(VerificationResult.safeParse(tasks[1].output.result).success).toBe(true);
    expect(tasks.every((t) => Number(t.cost_usd) === 0)).toBe(true);
    expect(tasks.flatMap((t) => t.usage).every((u) => u.provider === "mock")).toBe(true);
    // Auditoria identifica provedor e simulação.
    const [succeeded] = await sql.query<{ data: { provider: string; simulated: boolean } }>(
      `select data from audit_events where run_id = $1 and action = 'task.succeeded' order by id limit 1`,
      [run.id],
    );
    expect(succeeded.data).toMatchObject({ provider: "mock", simulated: true });
  });

  it("resultado simulado é marcado e nunca vira fonte real", async () => {
    process.env.AI_PROVIDER = "mock";
    const run = await runPipeline(envOrchestrator());
    const opp = await opportunityOf(run.id);
    expect(opp.simulated).toBe(true);
    expect(opp.summary).toContain("[SIMULADO]");
    expect(opp.source_urls.every((u) => new URL(u).hostname.endsWith(".invalid"))).toBe(true);
    const [{ n }] = await sql.query<{ n: string }>(`select count(*)::text as n from source_records where project_id = $1`, [projectId]);
    expect(Number(n)).toBe(0);
    // O portão de qualidade continua rodando sobre os dados de teste.
    expect(opp.quality_gate.passed).toBe(true);
  });

  it("um provedor real (roteirizado) grava fontes e não marca simulado", async () => {
    const provider = new ScriptedProvider().ok(researchResult(), [SRC_A, { url: "https://exemplo-especializado.com/gta6", title: "Site", page_age: null }]).ok(verificationResult(), []);
    const run = await runPipeline(orchestrator(sql, provider));
    const opp = await opportunityOf(run.id);
    expect(opp.simulated).toBe(false);
    const [{ n }] = await sql.query<{ n: string }>(`select count(*)::text as n from source_records where project_id = $1`, [projectId]);
    expect(Number(n)).toBeGreaterThan(0);
  });

  it("o mock é determinístico e encadeia a entrada do Verificador com a saída do Pesquisador", async () => {
    process.env.AI_PROVIDER = "mock";
    const a = await runPipeline(envOrchestrator());
    const [t1] = await taskRows(sql, a.id);
    const out1 = await sql.query<{ output: { result: unknown } }>(`select output from agent_tasks where run_id = $1 order by step_index`, [a.id]);
    // Segunda execução do mesmo tema: mesmo resultado (determinismo), agora reaproveitado do mesmo provedor.
    const b = await runPipeline(envOrchestrator());
    const out2 = await sql.query<{ output: { result: unknown } }>(`select output from agent_tasks where run_id = $1 order by step_index`, [b.id]);
    expect(out2.map((o) => o.output.result)).toEqual(out1.map((o) => o.output.result));
    const reused = await taskRows(sql, b.id);
    expect(reused.every((t) => t.reused_from !== null)).toBe(true);
    // Encadeamento: o Verificador recebeu exatamente o resultado do Pesquisador.
    const [, verifier] = await sql.query<{ input: { research: unknown } }>(`select input from agent_tasks where run_id = $1 order by step_index`, [a.id]);
    expect(verifier.input.research).toEqual(out1[0].output.result);
    expect(t1.agent_role).toBe("pesquisador");
  });

  it("mock também aceita a mesma chamada direta e rejeita papéis sem resposta de demonstração", async () => {
    const mock = new MockProvider();
    const base = { system: "s", prompt: "p", schema: z.unknown(), effort: "low" as const };
    const ok = await mock.generateStructured({ ...base, role: "pesquisador", input: { topic: "Tema X" } } as StructuredRequest<unknown>);
    expect(ResearchResult.safeParse(ok.data).success).toBe(true);
    expect(ok.usage[0].provider).toBe("mock");
    await expect(mock.generateStructured({ ...base, role: "roteirista", input: {} } as StructuredRequest<unknown>)).rejects.toMatchObject({
      code: "bad_request",
      retryable: false,
    });
  });
});

describe("portões, correções e falhas com o provedor de demonstração", () => {
  it("saída fora do contrato volta ao agente para correção e depois passa", async () => {
    const mock = new MockProvider("invalid_schema");
    const run = await runPipeline(orchestrator(sql, mock));
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const [first] = await taskRows(sql, run.id);
    expect(first.corrections).toBe(1);
    expect(await auditActions(sql, run.id)).toContain("task.validation_failed");
  });

  it("falha de limite é reagendada e a tarefa se recupera", async () => {
    const mock = new MockProvider("rate_limited");
    const orch = orchestrator(sql, mock);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    expect((await orch.processNext())?.outcome).toBe("retry_scheduled");
    await sql.query(`update agent_tasks set not_before = now() where run_id = $1`, [run.id]);
    await orch.drain(10);
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    expect(await auditActions(sql, run.id)).toContain("task.retry_scheduled");
  });

  it("contradição sem ressalva reprova no portão de qualidade (a execução conclui, a oportunidade não é liberada)", async () => {
    const run = await runPipeline(orchestrator(sql, new MockProvider("contradiction")));
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const opp = await opportunityOf(run.id);
    expect(opp.quality_gate.passed).toBe(false);
    expect(opp.status).toBe("nova");
    expect(opp.simulated).toBe(true);
  });
});

describe("escolha e alternância de provedor", () => {
  it("configuração do projeto vence a variável, e trocar não apaga nada", async () => {
    process.env.AI_PROVIDER = "mock";
    const first = await runPipeline(envOrchestrator());
    const before = await opportunityOf(first.id);

    // Projeto passa para um provedor real sem configuração: falha explícita, sem fallback para outro.
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste-nao-usar";
    await sql.query(`update content_projects set settings = settings || '{"ai_provider":"gemini"}'::jsonb where id = $1`, [projectId]);
    expect(resolveProviderId({ ai_provider: "gemini" })).toBe("gemini");
    const second = await runPipeline(envOrchestrator());
    expect(await runStatus(sql, second.id)).toBe("failed_action_required");
    const [task] = await taskRows(sql, second.id);
    expect(String((task.error as { message: string }).message)).toMatch(/Gemini/);
    const [{ provider }] = await sql.query<{ provider: string | null }>(`select provider from agent_tasks where id = $1`, [task.id]);
    expect(provider).toBeNull(); // a Anthropic NUNCA foi usada como fallback

    // Volta para demonstração: tudo o que existia continua lá.
    await sql.query(`update content_projects set settings = settings || '{"ai_provider":"mock"}'::jsonb where id = $1`, [projectId]);
    const [{ n }] = await sql.query<{ n: string }>(`select count(*)::text as n from content_projects where id = $1`, [projectId]);
    expect(Number(n)).toBe(1);
    expect((await opportunityOf(first.id)).summary).toBe(before.summary);
    const third = await runPipeline(envOrchestrator());
    expect(await runStatus(sql, third.id)).toBe("succeeded");
  });

  it("resultado de um provedor não é reaproveitado por outro", async () => {
    process.env.AI_PROVIDER = "mock";
    await runPipeline(envOrchestrator());
    const real = new ScriptedProvider().ok(researchResult(), [SRC_A, { url: "https://exemplo-especializado.com/gta6", title: "Site", page_age: null }]).ok(verificationResult(), []);
    const run = await runPipeline(orchestrator(sql, real));
    expect(real.calls.length).toBe(2); // chamou de verdade: nada de reuso do mock
    expect((await taskRows(sql, run.id)).every((t) => t.reused_from === null)).toBe(true);
  });

  it("ids inválidos são ignorados e anthropic só é usada se escolhida", () => {
    expect(resolveProviderId({ ai_provider: "qualquer" })).toBeNull();
    process.env.AI_PROVIDER = "banana";
    expect(resolveProviderId({})).toBeNull();
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste-nao-usar";
    expect(resolveProviderId({})).toBeNull();
  });
});

type Recorded = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>, calls: Recorded[] = []) {
  return async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
}
const geminiOk = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text }] }, ...extra }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      modelVersion: "gemini-teste",
    }),
    { status: 200 },
  );
const geminiError = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const reqFor = (over: Partial<StructuredRequest<unknown>> = {}): StructuredRequest<unknown> => ({
  system: "Você é um teste.",
  prompt: "Diga ok.",
  schema: z.object({ ok: z.boolean() }),
  effort: "low",
  ...over,
});

describe("adaptador Gemini (API simulada por fetch)", () => {
  it("sem GEMINI_API_KEY: pending_credential, sem chamar a rede", () => {
    let caught: unknown;
    try {
      new GeminiProvider();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConnectorError);
    expect(caught).toMatchObject({ code: "pending_credential", retryable: false });
  });

  it("sucesso: chave só no header, JSON validado, uso registrado e sem busca por padrão", async () => {
    const calls: Recorded[] = [];
    const key = "chave-de-teste-123456789";
    const provider = new GeminiProvider({ apiKey: key, model: "gemini-teste", fetch: fakeFetch(() => geminiOk('{"ok":true}'), calls), maxRequestsPerMinute: 100 });
    const res = await provider.generateStructured(reqFor({ webSearch: { maxUses: 3 }, knownSources: [{ url: "https://a.example/x", title: "A" }] }));
    expect(res.data).toEqual({ ok: true });
    expect(res.usage[0]).toMatchObject({ provider: "gemini", model: "gemini-teste", input_tokens: 100, output_tokens: 50, web_search_requests: 0 });
    // Sem busca: só as fontes conhecidas voltam como "recuperadas".
    expect(res.retrievedSources.map((s) => s.url)).toEqual(["https://a.example/x"]);
    expect(provider.capabilities).toEqual({ webSearch: false, simulated: false });
    const [call] = calls;
    expect(call.url).not.toContain(key);
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(key);
    const body = JSON.parse(String(call.init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.tools).toBeUndefined();
    expect(body.contents[0].parts[0].text).toContain("Não há ferramenta de pesquisa");
  });

  it("busca do Google só quando ligada: fontes vêm do grounding, não do texto do modelo", async () => {
    const calls: Recorded[] = [];
    const provider = new GeminiProvider({
      apiKey: "chave-de-teste-123456789",
      grounding: true,
      maxRequestsPerMinute: 100,
      fetch: fakeFetch(
        () =>
          geminiOk('{"ok":true}', {
            groundingMetadata: { webSearchQueries: ["q"], groundingChunks: [{ web: { uri: "https://g.example/1", title: "G1" } }, { web: {} }] },
          }),
        calls,
      ),
    });
    const res = await provider.generateStructured(reqFor({ webSearch: { maxUses: 3 } }));
    expect(res.retrievedSources).toEqual([{ url: "https://g.example/1", title: "G1", page_age: null }]);
    expect(res.usage[0].web_search_requests).toBe(1);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });

  const make = (fetch: ReturnType<typeof fakeFetch>) =>
    new GeminiProvider({ apiKey: "chave-de-teste-123456789", fetch, maxRequestsPerMinute: 100 });

  it("401/403 → authentication (não retentável)", async () => {
    await expect(make(fakeFetch(() => geminiError(403, { error: { message: "denied" } }))).generateStructured(reqFor())).rejects.toMatchObject({
      code: "authentication",
      retryable: false,
    });
  });

  it("429 por minuto → rate_limited retentável, com tempo de espera", async () => {
    const p = make(fakeFetch(() => geminiError(429, { error: { status: "RESOURCE_EXHAUSTED", message: "slow down", details: [{ retryDelay: "12s" }] } })));
    await expect(p.generateStructured(reqFor())).rejects.toMatchObject({ code: "rate_limited", retryable: true, details: { retry_after_seconds: 12 } });
  });

  it("429 diário → quota_exhausted (não retentável) com orientação de espera ou troca manual", async () => {
    const body = { error: { status: "RESOURCE_EXHAUSTED", message: "quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } };
    const err = await make(fakeFetch(() => geminiError(429, body))).generateStructured(reqFor()).catch((e) => e);
    expect(err).toMatchObject({ code: "quota_exhausted", retryable: false });
    expect(err.message).toMatch(/modo de demonstração/);
  });

  it("5xx e falha de rede → unavailable retentável; 400 → bad_request", async () => {
    await expect(make(fakeFetch(() => geminiError(503, {}))).generateStructured(reqFor())).rejects.toMatchObject({ code: "unavailable", retryable: true });
    await expect(
      make(fakeFetch(() => {
        throw new Error("socket hang up");
      })).generateStructured(reqFor()),
    ).rejects.toMatchObject({ code: "unavailable", retryable: true });
    await expect(make(fakeFetch(() => geminiError(400, { error: { message: "bad schema" } }))).generateStructured(reqFor())).rejects.toMatchObject({
      code: "bad_request",
      retryable: false,
    });
  });

  it("resposta que não é JSON vira dado nulo (cai no ciclo de correção); cortada vira truncated; bloqueada vira refusal", async () => {
    expect((await make(fakeFetch(() => geminiOk("isto não é json"))).generateStructured(reqFor())).data).toBeNull();
    const cut = new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }), { status: 200 });
    await expect(make(fakeFetch(() => cut)).generateStructured(reqFor())).rejects.toMatchObject({ code: "truncated", retryable: true });
    const blocked = new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 });
    await expect(make(fakeFetch(() => blocked)).generateStructured(reqFor())).rejects.toMatchObject({ code: "refusal", retryable: false });
  });

  it("entrada grande demais é recusada antes de qualquer chamada", async () => {
    const calls: Recorded[] = [];
    const p = make(fakeFetch(() => geminiOk("{}"), calls));
    await expect(p.generateStructured(reqFor({ prompt: "x".repeat(70_000) }))).rejects.toMatchObject({ code: "bad_request", retryable: false });
    expect(calls).toHaveLength(0);
  });

  it("limite local por minuto protege a cota gratuita sem esperar", async () => {
    const calls: Recorded[] = [];
    const p = new GeminiProvider({ apiKey: "chave-de-teste-123456789", maxRequestsPerMinute: 2, fetch: fakeFetch(() => geminiOk('{"ok":true}'), calls) });
    await p.generateStructured(reqFor());
    await p.generateStructured(reqFor());
    await expect(p.generateStructured(reqFor())).rejects.toMatchObject({ code: "rate_limited", retryable: true });
    expect(calls).toHaveLength(2);
  });

  it("a chave nunca aparece em mensagens de erro, mesmo se a API a ecoar", async () => {
    const key = "chave-secreta-9876543210";
    process.env.GEMINI_API_KEY = key;
    const p = new GeminiProvider({ apiKey: key, maxRequestsPerMinute: 100, fetch: fakeFetch(() => geminiError(400, { error: { message: `invalid key=${key}` } })) });
    const err = (await p.generateStructured(reqFor()).catch((e) => e)) as ConnectorError;
    expect(err.message).not.toContain(key);
    expect(JSON.stringify(err.details)).not.toContain(key);
  });

  it("Pesquisador com Gemini sem busca não aceita fonte inventada (URL fora das conhecidas)", async () => {
    const invented = researchResult(); // cita rockstargames.com, que NÃO foi recuperada nem informada
    const fetch = fakeFetch(() => geminiOk(JSON.stringify(invented)));
    const provider = new GeminiProvider({ apiKey: "chave-de-teste-123456789", fetch, maxRequestsPerMinute: 100 });
    const orch = orchestrator(sql, provider);
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    expect((await orch.processNext())?.outcome).toBe("correction_requested");
    const [task] = await taskRows(sql, run.id);
    expect(JSON.stringify(task.input)).toContain("Fonte não recuperada");
  });

  it("Pesquisador com Gemini sem busca e sem fontes registra a limitação em vez de inventar", async () => {
    const honest = researchResult({ sources: [], claims_to_verify: [], unknowns: ["Nenhum conector de pesquisa ativo: nada foi pesquisado."], relevance: { score: 10, reason: "Sem dados." } });
    const provider = new GeminiProvider({ apiKey: "chave-de-teste-123456789", fetch: fakeFetch(() => geminiOk(JSON.stringify(honest))), maxRequestsPerMinute: 100 });
    const orch = orchestrator(sql, provider);
    await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    expect((await orch.processNext())?.outcome).toBe("succeeded");
  });
});

describe("teste de conexão do Gemini", () => {
  it("sem chave", async () => {
    expect(await testGeminiConnection({ fetch: fakeFetch(() => geminiOk("{}")) })).toMatchObject({ ok: false, code: "pending_credential" });
  });
  it("chave aceita, recusada, modelo inexistente e rede fora", async () => {
    process.env.GEMINI_API_KEY = "chave-de-teste-123456789";
    expect(await testGeminiConnection({ fetch: fakeFetch(() => new Response("{}", { status: 200 })) })).toMatchObject({ ok: true, code: "ok" });
    expect(await testGeminiConnection({ fetch: fakeFetch(() => new Response("{}", { status: 403 })) })).toMatchObject({ ok: false, code: "authentication" });
    expect(await testGeminiConnection({ fetch: fakeFetch(() => new Response("{}", { status: 404 })) })).toMatchObject({ ok: false, code: "bad_request" });
    expect(
      await testGeminiConnection({
        fetch: fakeFetch(() => {
          throw new Error("offline");
        }),
      }),
    ).toMatchObject({ ok: false, code: "unavailable" });
  });

  // Integração REAL: só roda com GEMINI_API_KEY no ambiente. Sem a chave aparece como "ignorado", nunca como aprovado.
  it.skipIf(!savedKeyPresent())("integração real com a API do Gemini", async () => {
    process.env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY;
    const conn = await testGeminiConnection();
    expect(conn.ok, conn.message).toBe(true);
    const provider = new GeminiProvider();
    const res = await provider.generateStructured(reqFor({ prompt: 'Responda com {"ok": true}.' }));
    expect(res.data).toEqual({ ok: true });
  });
});

function savedKeyPresent() {
  return Boolean(process.env.GEMINI_API_KEY);
}

describe("Ollama (API simulada)", () => {
  it("sem modelo configurado: pending_credential", () => {
    expect(() => new OllamaProvider()).toThrowError(ConnectorError);
  });
  it("usa só as fontes conhecidas e registra o uso", async () => {
    const calls: Recorded[] = [];
    const p = new OllamaProvider({
      model: "llama-teste",
      baseUrl: "http://ollama.local:11434",
      fetch: fakeFetch(() => new Response(JSON.stringify({ message: { content: '{"ok":true}' }, prompt_eval_count: 7, eval_count: 3 }), { status: 200 }), calls),
    });
    const res = await p.generateStructured(reqFor({ webSearch: { maxUses: 2 }, knownSources: [{ url: "https://a.example/x", title: "A" }] }));
    expect(res.data).toEqual({ ok: true });
    expect(res.retrievedSources).toHaveLength(1);
    expect(res.usage[0]).toMatchObject({ provider: "ollama", input_tokens: 7, output_tokens: 3 });
    expect(calls[0].url).toBe("http://ollama.local:11434/api/chat");
  });
  it("servidor fora do ar vira unavailable; teste de conexão confere o modelo", async () => {
    const p = new OllamaProvider({
      model: "m",
      fetch: fakeFetch(() => {
        throw new Error("ECONNREFUSED");
      }),
    });
    await expect(p.generateStructured(reqFor())).rejects.toMatchObject({ code: "unavailable", retryable: true });
    process.env.OLLAMA_MODEL = "llama-teste";
    const tags = fakeFetch(() => new Response(JSON.stringify({ models: [{ name: "llama-teste:latest" }] }), { status: 200 }));
    expect(await testOllamaConnection({ fetch: tags })).toMatchObject({ ok: true });
    process.env.OLLAMA_MODEL = "outro";
    expect(await testOllamaConnection({ fetch: tags })).toMatchObject({ ok: false });
  });
});

describe("conectores, configurações e segredos", () => {
  it("cada integração tem status próprio; YouTube é opcional e honesto", () => {
    const list = listConnectors();
    expect(list.find((c) => c.id === "ia_mock")?.state).toBe("demo");
    expect(list.find((c) => c.id === "ia_gemini")?.state).toBe("pending_credential");
    expect(list.find((c) => c.id === "youtube")?.state).toBe("pending_credential");
    expect(list.find((c) => c.id === "youtube")?.notes).toMatch(/Opcional/);
    process.env.GEMINI_API_KEY = "chave-de-teste-123456789";
    process.env.YOUTUBE_API_KEY = "yt-de-teste-123456789";
    const again = listConnectors();
    expect(again.find((c) => c.id === "ia_gemini")?.state).toBe("credential_present");
    expect(again.find((c) => c.id === "youtube")?.notes).toMatch(/não baixa o arquivo do vídeo/);
  });

  it("a descrição dos provedores nunca expõe valores de credenciais", () => {
    process.env.GEMINI_API_KEY = "valor-secreto-gemini-123";
    process.env.ANTHROPIC_API_KEY = "valor-secreto-claude-123";
    process.env.YOUTUBE_API_KEY = "valor-secreto-youtube-123";
    const dump = JSON.stringify([describeProviders(), listConnectors()]);
    for (const secret of ["valor-secreto-gemini-123", "valor-secreto-claude-123", "valor-secreto-youtube-123"]) expect(dump).not.toContain(secret);
    expect(describeProviders().find((p) => p.id === "gemini")?.configured).toBe(true);
  });

  it("nenhum código de cliente importa conectores nem segredos; só variáveis públicas vão ao navegador", () => {
    const root = path.join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(root);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/^["']use client["']/.test(text.trimStart())) {
        expect(text, `${file} é código de cliente`).not.toMatch(/@\/connectors|\.\.\/connectors|process\.env\.(?!NEXT_PUBLIC_)/);
      }
      for (const m of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
        expect(m[0], `${file}`).not.toMatch(/GEMINI|ANTHROPIC|DATABASE|SECRET|SERVICE_ROLE|OLLAMA|YOUTUBE/);
      }
    }
    const example = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(example).not.toMatch(/^NEXT_PUBLIC_[A-Z_]*(GEMINI|ANTHROPIC|DATABASE|SECRET)/m);
    expect(example).toMatch(/^GEMINI_API_KEY=$/m); // sem valores reais no exemplo
  });
});

describe("adaptador do Postgres real (postgres.js)", () => {
  it("strings JSON passam sem dupla serialização para jsonb; objetos continuam serializados", async () => {
    const { POSTGRES_JSON_TYPE } = await import("@/db/postgres");
    expect(POSTGRES_JSON_TYPE.serialize('{"a":1}')).toBe('{"a":1}');
    expect(POSTGRES_JSON_TYPE.serialize({ a: 1 })).toBe('{"a":1}');
    expect(POSTGRES_JSON_TYPE.parse('{"a":1}')).toEqual({ a: 1 });
    // O serializador vale para json (114) e jsonb (3802), como no tipo padrão do driver.
    expect(POSTGRES_JSON_TYPE.to).toBe(114);
    expect(POSTGRES_JSON_TYPE.from).toEqual([114, 3802]);
  });

  it("o driver realmente usa o serializador configurado para parâmetros jsonb (sem conectar)", async () => {
    const { default: postgres } = await import("postgres");
    const { POSTGRES_JSON_TYPE } = await import("@/db/postgres");
    const configured = postgres("postgres://u:p@127.0.0.1:1/db", { types: { json: POSTGRES_JSON_TYPE } });
    const stock = postgres("postgres://u:p@127.0.0.1:1/db");
    try {
      // Sem o ajuste, o driver serializa de novo a string JSON (a causa do jsonb "texto dentro de JSON").
      expect(stock.options.serializers[3802]('{"x":true}')).toBe('"{\\"x\\":true}"');
      expect(configured.options.serializers[3802]('{"x":true}')).toBe('{"x":true}');
      expect(configured.options.serializers[3802]({ x: true })).toBe('{"x":true}');
    } finally {
      await configured.end({ timeout: 0 });
      await stock.end({ timeout: 0 });
    }
  });
});
