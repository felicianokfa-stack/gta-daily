import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ResearchResult, VerificationResult } from "@/core/contracts/research";
import { getNiche } from "@/core/niches";
import { verificador } from "@/agents/verificador";
import { estimateCost } from "@/connectors/pricing";
import type { Sql } from "@/db/sql";
import { NotFoundError } from "@/orchestrator/engine";
import { evaluateQualityGate, suggestedPriority, verificationState } from "@/orchestrator/quality-gate";
import type { OpportunityRow, SourceRecordRow } from "@/orchestrator/types";
import {
  SRC_A,
  SRC_B,
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

const niche = getNiche("gta-vi");
const SRC_C = { url: "https://outro-veiculo.net/gta-vi-data", title: "Outro veículo", page_age: null };
const input = { topic: "Data de lançamento do GTA VI", goal: "Post de notícia" };

let sql: Sql;
let raw: PGlite;
let userId: string;
let projectId: string;

beforeEach(async () => {
  ({ sql, raw } = await setupDb());
  userId = await createUser(sql);
  projectId = (await createGtaProject(sql, userId)).id;
});

const research = (o: Record<string, unknown> = {}) => ResearchResult.parse(researchResult(o));
const verification = (o: Record<string, unknown> = {}) => VerificationResult.parse(verificationResult(o));

describe("portão de qualidade", () => {
  it("aprova fato confirmado por fonte primária oficial", () => {
    const gate = evaluateQualityGate(research(), verification(), niche);
    expect(gate.passed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("reprova fato confirmado só por uma fonte secundária", () => {
    const v = verification({
      claims: [{ claim: "Data anunciada.", label: "fato_confirmado", confidence: "media", evidence_urls: [SRC_B.url], notes: "" }],
    });
    const gate = evaluateQualityGate(research(), v, niche);
    expect(gate.passed).toBe(false);
    expect(gate.checks.find((c) => c.rule === "evidencia_suficiente")?.passed).toBe(false);
  });

  it("aprova fato confirmado por duas fontes secundárias independentes", () => {
    const v = verification({
      additional_sources: [{ url: SRC_C.url, title: SRC_C.title, publisher: null, published_at: null }],
      claims: [{ claim: "Data anunciada.", label: "fato_confirmado", confidence: "alta", evidence_urls: [SRC_B.url, SRC_C.url], notes: "" }],
    });
    expect(evaluateQualityGate(research(), v, niche).passed).toBe(true);
  });

  it("reprova evidência sem fonte registrada e contradição sem ressalva", () => {
    const v = verification({
      claims: [{ claim: "X", label: "fato_confirmado", confidence: "alta", evidence_urls: [SRC_A.url, "https://nao-registrada.com/x"], notes: "" }],
      contradictions: ["Fontes divergem sobre a data."],
      caveats: [],
    });
    const gate = evaluateQualityGate(research(), v, niche);
    expect(gate.passed).toBe(false);
    expect(gate.checks.filter((c) => !c.passed).map((c) => c.rule)).toEqual(["rastreabilidade", "contradicoes_explicadas"]);
  });

  it("estado de verificação e prioridade sugerida", () => {
    expect(verificationState(verification())).toBe("verificada");
    const partial = verification({
      claims: [...verificationResult().claims, { claim: "Y", label: "nao_verificado", confidence: "baixa", evidence_urls: [], notes: "" }],
    });
    expect(verificationState(partial)).toBe("parcial");
    expect(verificationState(verification({ claims: [] }))).toBe("nao_verificada");
    expect(suggestedPriority(true, 80)).toBe("alta");
    expect(suggestedPriority(true, 40)).toBe("media");
    expect(suggestedPriority(false, 40)).toBe("baixa");
  });
});

describe("verificador: fontes adicionais", () => {
  const vInput = () => verificador.inputSchema.parse({ topic: "T", niche_id: "gta-vi", research: research() });

  it("aceita evidência de fonte nova recuperada na busca e registrada em additional_sources", () => {
    const v = verification({
      additional_sources: [{ url: SRC_C.url, title: SRC_C.title, publisher: null, published_at: null }],
      claims: [{ claim: "Z", label: "rumor", confidence: "baixa", evidence_urls: [SRC_C.url], notes: "" }],
    });
    expect(verificador.validate(vInput(), v, [SRC_C]).errors).toEqual([]);
  });

  it("rejeita fonte adicional não recuperada e evidência fora das fontes registradas", () => {
    const v = verification({
      additional_sources: [{ url: SRC_C.url, title: SRC_C.title, publisher: null, published_at: null }],
      claims: [{ claim: "Z", label: "rumor", confidence: "baixa", evidence_urls: ["https://outra.com/nao-registrada"], notes: "" }],
    });
    const errors = verificador.validate(vInput(), v, []).errors;
    expect(errors.some((e) => e.includes(SRC_C.url))).toBe(true);
    expect(errors.some((e) => e.includes("outra.com"))).toBe(true);
  });
});

describe("fontes e oportunidades", () => {
  it("ao concluir, registra fontes (primária/secundária) e cria oportunidade pronta para estratégia", async () => {
    const orch = orchestrator(sql, new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]).ok(verificationResult()));
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.drain();

    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const sources = await sql.query<SourceRecordRow>(`select * from source_records order by url`);
    expect(sources.map((s) => [s.url, s.kind])).toEqual([
      [SRC_B.url, "secundaria"],
      [SRC_A.url, "primaria"],
    ]);
    const [opp] = await sql.query<OpportunityRow>(`select * from opportunities where run_id = $1`, [run.id]);
    expect(opp.status).toBe("pronta_para_estrategia");
    expect(opp.verification_state).toBe("verificada");
    expect(opp.relevance).toBe(80);
    expect(opp.priority).toBe("alta");
    expect(opp.quality_gate.passed).toBe(true);
    expect(opp.source_urls.sort()).toEqual([SRC_A.url, SRC_B.url].sort());
  });

  it("reprovada no portão: fica como 'nova' com os motivos visíveis", async () => {
    const weak = verificationResult({
      claims: [{ claim: "Data anunciada.", label: "fato_confirmado", confidence: "media", evidence_urls: [SRC_B.url], notes: "" }],
    });
    const orch = orchestrator(sql, new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]).ok(weak));
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.drain();
    const [opp] = await sql.query<OpportunityRow>(`select * from opportunities where run_id = $1`, [run.id]);
    expect(opp.status).toBe("nova");
    expect(opp.quality_gate.reasons[0]).toMatch(/fonte primária/);
  });

  it("nova pesquisa recebe as fontes já conhecidas e não duplica registros", async () => {
    const provider = new ScriptedProvider()
      .ok(researchResult(), [SRC_A, SRC_B])
      .ok(verificationResult())
      .ok(researchResult({ topic: "Trailer 3" }), [SRC_A, SRC_B])
      .ok(verificationResult());
    const orch = orchestrator(sql, provider);
    await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.drain();
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input: { topic: "Trailer 3 do GTA VI" } });
    await orch.drain();

    const [researchTask] = await taskRows(sql, run.id);
    expect((researchTask.input.known_sources as unknown[]).length).toBe(2);
    expect(provider.calls[2].prompt).toContain("<fontes_ja_conhecidas>");
    const sources = await sql.query<SourceRecordRow>(`select * from source_records`);
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.times_seen === 2)).toBe(true);
    expect(await sql.query(`select id from opportunities`)).toHaveLength(2);
  });

  it("o usuário decide sobre a oportunidade (auditado); outro usuário não consegue", async () => {
    const orch = orchestrator(sql, new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]).ok(verificationResult()));
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.drain();
    const [opp] = await sql.query<OpportunityRow>(`select * from opportunities where run_id = $1`, [run.id]);

    const other = await createUser(sql);
    await expect(orch.decideOpportunity(other, opp.id, "descartada")).rejects.toBeInstanceOf(NotFoundError);
    await orch.decideOpportunity(userId, opp.id, "descartada");
    const [after] = await sql.query<OpportunityRow>(`select * from opportunities where id = $1`, [opp.id]);
    expect(after.status).toBe("descartada");
    expect(after.decided_by).toBe("user");
    expect(await auditActions(sql, run.id)).toContain("opportunity.decided");
  });
});

describe("custo e orçamento", () => {
  it("calcula custo a preço de lista por modelo, buscas e cache", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, web_search_requests: 5 };
    // Sonnet 5.5: 2 + 1 + 0,20 + 0,05
    expect(estimateCost([{ model: "claude-sonnet-5-5", ...usage }]).usd).toBeCloseTo(3.25, 4);
    // Opus 5.5: 4 + 2 + 0,20 + 0,05
    expect(estimateCost([{ model: "claude-opus-5-5", ...usage }]).usd).toBeCloseTo(6.25, 4);
    // Sonnet 5 (fallback) não pode ser confundido com Sonnet 5.5, e escrita no cache custa 1,25×.
    expect(estimateCost([{ model: "claude-sonnet-5", ...usage, cache_creation_input_tokens: 1_000_000 }]).usd).toBeCloseTo(5.75, 4);
    const unknown = estimateCost([{ model: "modelo-x", ...usage }]);
    expect(unknown.unpriced).toEqual(["modelo-x"]);
    expect(unknown.usd).toBeCloseTo(0.05, 4);
  });

  it("grava o custo de cada etapa e para em 'exige ação' quando o orçamento mensal estoura", async () => {
    const limited = (await createGtaProject(sql, userId, { monthly_budget_usd: 0.05 })).id;
    const provider = new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]).ok(verificationResult());
    const orch = orchestrator(sql, provider);
    const { run } = await orch.createRun({ userId, projectId: limited, pipeline: "pesquisa_verificacao", input });

    expect((await orch.processNext())?.outcome).toBe("succeeded");
    const [first] = await sql.query<{ cost_usd: string }>(`select cost_usd from agent_tasks where run_id = $1 and step_index = 0`, [run.id]);
    // 10 mil tokens de entrada + 2 mil de saída no Sonnet 5.5 + 3 buscas = 0,02 + 0,02 + 0,03
    expect(Number(first.cost_usd)).toBeCloseTo(0.07, 4);
    expect(await orch.monthSpend(limited)).toBeCloseTo(0.07, 4);

    expect((await orch.processNext())?.outcome).toBe("action_required");
    expect(provider.calls).toHaveLength(1);
    const tasks = await taskRows(sql, run.id);
    expect((tasks[1].error as { code: string }).code).toBe("budget_exceeded");
    expect(await runStatus(sql, run.id)).toBe("failed_action_required");
  });
});

describe("RLS das tabelas novas", () => {
  it("o dono lê fontes e oportunidades; outro usuário não lê e ninguém escreve pelo cliente", async () => {
    const orch = orchestrator(sql, new ScriptedProvider().ok(researchResult(), [SRC_A, SRC_B]).ok(verificationResult()));
    await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input });
    await orch.drain();
    const other = await createUser(sql);

    const as = async <T>(uid: string, fn: () => Promise<T>) => {
      await raw.exec(`set role authenticated`);
      await raw.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      try {
        return await fn();
      } finally {
        await raw.exec(`reset role`);
      }
    };
    const count = async (table: string) => (await raw.query(`select id from ${table}`)).rows.length;

    expect(await as(userId, () => count("opportunities"))).toBe(1);
    expect(await as(userId, () => count("source_records"))).toBe(2);
    expect(await as(other, () => count("opportunities"))).toBe(0);
    expect(await as(other, () => count("source_records"))).toBe(0);
    await as(userId, async () => {
      await expect(raw.query(`update opportunities set status = 'descartada'`)).rejects.toThrow(/permission denied/);
      await expect(raw.query(`delete from source_records`)).rejects.toThrow(/permission denied/);
    });
  });
});
