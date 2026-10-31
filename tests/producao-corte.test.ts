import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { distribuidor } from "@/agents/distribuidor";
import { estrategista } from "@/agents/estrategista";
import { produtorAudiovisual } from "@/agents/produtor-audiovisual";
import { revisorQualidade } from "@/agents/revisor-qualidade";
import { roteirista } from "@/agents/roteirista";
import { MockProvider } from "@/connectors/ai/mock";
import type { ModelProvider, StructuredRequest, StructuredResponse } from "@/connectors/types";
import {
  ClipContext,
  Distribution,
  ProductionPlan,
  ReviewerInput,
  ReviewResult,
  ScriptResult,
  StrategyBrief,
} from "@/core/contracts/content";
import type { Sql } from "@/db/sql";
import { evaluateDraftGate } from "@/orchestrator/draft-gate";
import { InvalidStateError, NotFoundError, Orchestrator } from "@/orchestrator/engine";
import {
  createSampleMedia,
  decideDraft,
  getDraft,
  listClipCandidates,
  listDrafts,
  setClipStatus,
} from "@/orchestrator/queries";
import { auditActions, createGtaProject, createUser, runStatus, setupDb, taskRows } from "./helpers";

let sql: Sql;
let raw: PGlite;
let userId: string;
let projectId: string;

beforeEach(async () => {
  ({ sql, raw } = await setupDb());
  userId = await createUser(sql);
  projectId = (await createGtaProject(sql, userId)).id;
});

// ------------------------------------------------------------------ pacote válido de referência

const SEGMENTS = [
  { id: 1, start_s: 0, end_s: 20, text: "Abertura do vídeo de teste, falando de um jogo imaginário." },
  { id: 2, start_s: 20, end_s: 45, text: "O narrador diz que isto é só a opinião dele e que nada foi confirmado." },
  { id: 3, start_s: 45, end_s: 70, text: "Ele menciona um boato inventado sobre um modo online." },
];
const ctx = (over: Record<string, unknown> = {}): ClipContext =>
  ClipContext.parse({
    clip_id: "00000000-0000-4000-8000-000000000001",
    media_id: "00000000-0000-4000-8000-000000000002",
    media_title: "Material de teste",
    title: "Corte de teste",
    justification: "Trecho completo.",
    start_s: 0,
    end_s: 70,
    segments: SEGMENTS,
    platforms: ["instagram_reels", "tiktok"],
    niche_id: "gta-vi",
    ...over,
  });

const brief = (over: Record<string, unknown> = {}): StrategyBrief =>
  StrategyBrief.parse({
    angle: "Conversa sobre um jogo imaginário",
    hook: "Você sabia que isto é só opinião?",
    audience: "Fãs de jogos",
    key_messages: [
      { text: "O narrador deixa claro que é opinião.", label: "estimativa", segment_ids: [2] },
      { text: "Existe um boato sobre um modo online.", label: "rumor", segment_ids: [3] },
    ],
    cta: "Conte o que você acha.",
    platform_priority: ["instagram_reels"],
    cautions: ["Há um boato: não tratar como fato."],
    ...over,
  });

const beats = (over: Record<string, unknown>[] = []) => {
  const base = SEGMENTS.map((s) => ({
    t_start: s.start_s,
    t_end: s.end_s,
    voiceover: s.text,
    on_screen_text: "",
    segment_id: s.id,
    quote: null as string | null,
  }));
  return base.map((b, i) => ({ ...b, ...(over[i] ?? {}) }));
};
const script = (over: Record<string, unknown> = {}): ScriptResult =>
  ScriptResult.parse({ beats: beats(), total_seconds: 70, disclaimers: ["Roteiro de teste."], ...over });

const plan = (over: Record<string, unknown> = {}): ProductionPlan =>
  ProductionPlan.parse({
    format: "9:16",
    rendered: false,
    summary: "Plano de teste.",
    cuts: SEGMENTS.map((s) => ({ t_start: s.start_s, t_end: s.end_s, framing: "Centralizado", note: "" })),
    subtitles: SEGMENTS.map((s) => ({ t_start: s.start_s, t_end: s.end_s, text: "Legenda curta de teste" })),
    audio_notes: [],
    assets_needed: ["Arquivo de vídeo original"],
    ...over,
  });

const version = (platform: string, over: Record<string, unknown> = {}) => ({
  platform,
  title: "Título de teste",
  caption: "Legenda de teste.",
  hashtags: ["#teste", "#exemplo"],
  cover_text: "Capa",
  timing_note: "",
  ...over,
});
const distribution = (versions = [version("instagram_reels"), version("tiktok")]): Distribution => Distribution.parse({ versions });

const review = (over: Record<string, unknown> = {}): ReviewResult =>
  ReviewResult.parse({
    verdict: "aprovado_para_revisao",
    summary: "Tudo conferido.",
    checks: [{ rule: "tempos", passed: true, detail: "ok" }],
    issues: [],
    suggested_fixes: [],
    ...over,
  });

const errorsOf = (v: { errors: string[] }) => v.errors.join(" | ");

// ------------------------------------------------------------------ contratos e validação por papel

describe("contratos de produção", () => {
  it("o briefing nunca aceita 'fato_confirmado' (a transcrição não confirma fatos)", () => {
    const bad = StrategyBrief.safeParse({ ...brief(), key_messages: [{ text: "x", label: "fato_confirmado", segment_ids: [1] }] });
    expect(bad.success).toBe(false);
  });

  it("o plano de edição é sempre 'não renderizado' e 9:16", () => {
    expect(ProductionPlan.safeParse({ ...plan(), rendered: true }).success).toBe(false);
    expect(ProductionPlan.safeParse({ ...plan(), format: "16:9" }).success).toBe(false);
  });
});

describe("Estrategista: validação", () => {
  it("aceita um briefing coerente", () => {
    expect(estrategista.validate(ctx(), brief(), []).errors).toEqual([]);
  });
  it.each([
    ["segmento fora do corte", brief({ key_messages: [{ text: "x", label: "rumor", segment_ids: [99] }] }), /fora do corte/],
    ["plataforma fora do projeto", brief({ platform_priority: ["youtube_shorts"] }), /não usa/],
    ["promessa de resultado", brief({ hook: "Este vídeo vai viralizar com certeza" }), /promete resultado/],
    ["vazamento tratado como oficial", brief({ angle: "Um vazamento oficial do jogo" }), /vazamento/],
  ])("rejeita: %s", (_n, bad, pattern) => {
    expect(errorsOf(estrategista.validate(ctx(), bad, []))).toMatch(pattern);
  });
});

describe("Roteirista: validação", () => {
  const input = () => ({ ...ctx(), brief: brief() });
  it("aceita roteiro dentro do corte, com citação literal", () => {
    const ok = script({ beats: beats([{}, { quote: "isto é só a opinião dele" }]) });
    expect(roteirista.validate(input(), ok, []).errors).toEqual([]);
  });
  it.each([
    ["batida fora do corte", script({ beats: beats([{}, {}, { t_start: 60, t_end: 200 }]) }), /fora do corte/],
    ["duração total diferente do corte", script({ total_seconds: 30 }), /difere da duração/],
    ["citação inventada", script({ beats: beats([{ quote: "frase que ninguém disse" }]) }), /não aparece literalmente/],
    ["citação sem segmento", script({ beats: beats([{ segment_id: null, quote: "algo" }]) }), /sem um "segment_id"/],
    ["segmento inexistente", script({ beats: beats([{ segment_id: 77 }]) }), /fora do corte/],
    ["promessa de resultado", script({ beats: beats([{ voiceover: "Com este corte, garantia de sucesso" }]) }), /promete resultado/],
  ])("rejeita: %s", (_n, bad, pattern) => {
    expect(errorsOf(roteirista.validate(input(), bad, []))).toMatch(pattern);
  });
});

describe("Produtor Audiovisual: validação", () => {
  const input = () => ({ ...ctx(), brief: brief(), script: script() });
  it("aceita plano coerente e avisa que nada foi renderizado", () => {
    const v = produtorAudiovisual.validate(input(), plan(), []);
    expect(v.errors).toEqual([]);
    expect(v.warnings.join(" ")).toMatch(/nenhum arquivo de vídeo/);
  });
  it.each([
    ["corte fora do intervalo", plan({ cuts: [{ t_start: 60, t_end: 300, framing: "x", note: "" }] }), /fora do corte/],
    ["legenda com linha longa", plan({ subtitles: [{ t_start: 0, t_end: 5, text: "x".repeat(60) }] }), /mais de 42/],
    ["legenda com 3 linhas", plan({ subtitles: [{ t_start: 0, t_end: 5, text: "a\nb\nc" }] }), /mais de 2 linhas/],
    ["legenda curta demais", plan({ subtitles: [{ t_start: 0, t_end: 0.3, text: "oi" }] }), /dura só/],
  ])("rejeita: %s", (_n, bad, pattern) => {
    expect(errorsOf(produtorAudiovisual.validate(input(), bad, []))).toMatch(pattern);
  });
});

describe("Distribuidor: validação", () => {
  const input = () => ({ ...ctx(), brief: brief(), script: script() });
  it("aceita uma versão por plataforma do projeto", () => {
    expect(distribuidor.validate(input(), distribution(), []).errors).toEqual([]);
  });
  it.each([
    ["plataforma faltando", distribution([version("instagram_reels")]), /Falta a versão da plataforma tiktok/],
    ["plataforma fora do projeto", distribution([version("instagram_reels"), version("tiktok"), version("youtube_shorts")]), /não pertence ao projeto/],
    ["plataforma repetida", distribution([version("instagram_reels"), version("instagram_reels"), version("tiktok")]), /aparece 2 vezes/],
    ["legenda acima do limite", distribution([version("instagram_reels", { caption: "x".repeat(2300) }), version("tiktok")]), /limite 2200/],
    ["hashtag inválida", distribution([version("instagram_reels", { hashtags: ["sem-cerquilha"] }), version("tiktok")]), /hashtag inválida/],
    ["hashtags repetidas", distribution([version("instagram_reels", { hashtags: ["#a", "#A"] }), version("tiktok")]), /repetidas/],
    ["promessa de resultado", distribution([version("instagram_reels", { caption: "Isso vai viralizar" }), version("tiktok")]), /promete resultado/],
  ])("rejeita: %s", (_n, bad, pattern) => {
    expect(errorsOf(distribuidor.validate(input(), bad, []))).toMatch(pattern);
  });
});

describe("Revisor de Qualidade: validação", () => {
  const input = () => ReviewerInput.parse({ ...ctx(), brief: brief(), script: script(), plan: plan(), distribution: distribution() });
  it("aceita um veredito consistente", () => {
    expect(revisorQualidade.validate(input(), review(), []).errors).toEqual([]);
  });
  it("rejeita aprovação com checagem reprovada e reprovação sem problemas listados", () => {
    const contradictory = review({ checks: [{ rule: "tempos", passed: false, detail: "x" }] });
    expect(errorsOf(revisorQualidade.validate(input(), contradictory, []))).toMatch(/checagens reprovadas/);
    const noIssues = review({ verdict: "ajustes", issues: [] });
    expect(errorsOf(revisorQualidade.validate(input(), noIssues, []))).toMatch(/listar os problemas/);
  });
});

// ------------------------------------------------------------------ portão determinístico

describe("portão do rascunho", () => {
  const gate = (over: Partial<{ b: StrategyBrief; s: ScriptResult; p: ProductionPlan; d: Distribution; r: ReviewResult }> = {}) =>
    evaluateDraftGate(ctx(), over.b ?? brief(), over.s ?? script(), over.p ?? plan(), over.d ?? distribution(), over.r ?? review());

  it("aprova um pacote consistente", () => {
    const g = gate();
    expect(g.passed).toBe(true);
    expect(g.checks.map((c) => c.rule)).toEqual(["tempos", "citacoes", "rotulos", "plataformas", "plano_nao_renderizado", "revisor"]);
  });
  it("reprova por tempos, citação, rótulo, plataforma e veredito do revisor", () => {
    expect(gate({ p: plan({ cuts: [{ t_start: 0, t_end: 999, framing: "x", note: "" }] }) }).reasons.join(" ")).toMatch(/fora do corte/);
    expect(gate({ s: script({ beats: beats([{ quote: "frase inventada" }]) }) }).checks.find((c) => c.rule === "citacoes")?.passed).toBe(false);
    const forged = { ...brief(), key_messages: [{ text: "x", label: "fato_confirmado", segment_ids: [1] }] } as unknown as StrategyBrief;
    expect(gate({ b: forged }).checks.find((c) => c.rule === "rotulos")?.passed).toBe(false);
    expect(gate({ d: distribution([version("instagram_reels")]) }).checks.find((c) => c.rule === "plataformas")?.passed).toBe(false);
    const adjustments = review({ verdict: "ajustes", issues: ["Ajustar o gancho."] });
    const g = gate({ r: adjustments });
    expect(g.passed).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/ajustes/);
  });
});

// ------------------------------------------------------------------ pipeline ponta a ponta (demonstração)

function mockOrchestrator(provider: ModelProvider = new MockProvider()) {
  return new Orchestrator({ sql, providerFactory: () => provider, workerId: "t" });
}

async function selectedClip(analysisProvider?: ModelProvider) {
  const media = await createSampleMedia(sql, userId, projectId);
  const orch = mockOrchestrator(analysisProvider);
  const { run } = await orch.createRun({ userId, projectId, pipeline: "analise_midia", input: { media_id: media.id } });
  await orch.drain(10);
  expect(await runStatus(sql, run.id)).toBe("succeeded");
  const clip = (await listClipCandidates(sql, userId, media.id))[0];
  await setClipStatus(sql, userId, clip.id, "selecionado");
  return { media, clip };
}

async function produce(orch: Orchestrator, clipId: string) {
  const { run } = await orch.createRun({ userId, projectId, pipeline: "producao_corte", input: { clip_id: clipId } });
  await orch.drain(20);
  return run;
}

describe("pipeline producao_corte", () => {
  it("gera briefing, roteiro, plano, versões e revisão em ordem, e grava um rascunho simulado em revisão", async () => {
    const { clip } = await selectedClip();
    const run = await produce(mockOrchestrator(), clip.id);
    expect(await runStatus(sql, run.id)).toBe("succeeded");

    const tasks = await taskRows(sql, run.id);
    expect(tasks.map((t) => [t.agent_role, t.status])).toEqual([
      ["estrategista", "succeeded"],
      ["roteirista", "succeeded"],
      ["produtor_audiovisual", "succeeded"],
      ["distribuidor", "succeeded"],
      ["revisor_qualidade", "succeeded"],
    ]);
    const providers = await sql.query<{ provider: string }>(`select distinct provider from agent_tasks where run_id = $1`, [run.id]);
    expect(providers).toEqual([{ provider: "mock" }]);

    // Encadeamento: cada papel recebeu o resultado do anterior.
    const rows = await sql.query<{ agent_role: string; input: Record<string, unknown>; output: { result: unknown } }>(
      `select agent_role, input, output from agent_tasks where run_id = $1 order by step_index`,
      [run.id],
    );
    const result = Object.fromEntries(rows.map((r) => [r.agent_role, r.output.result]));
    const input = Object.fromEntries(rows.map((r) => [r.agent_role, r.input]));
    expect(input.roteirista.brief).toEqual(result.estrategista);
    expect(input.produtor_audiovisual.script).toEqual(result.roteirista);
    expect(input.revisor_qualidade.plan).toEqual(result.produtor_audiovisual);
    expect(input.revisor_qualidade.distribution).toEqual(result.distribuidor);

    const [draft] = await listDrafts(sql, userId);
    expect(draft).toMatchObject({ status: "em_revisao", simulated: true, clip_id: clip.id, run_id: run.id });
    expect(draft.gate.passed).toBe(true);
    expect(draft.production_plan.rendered).toBe(false);
    expect(draft.platform_versions.map((v) => v.platform)).toEqual(["instagram_reels"]);
    const [types] = await sql.query<Record<string, string>>(
      `select jsonb_typeof(brief) b, jsonb_typeof(script) s, jsonb_typeof(production_plan) p, jsonb_typeof(platform_versions) v, jsonb_typeof(review) r, jsonb_typeof(gate) g from clip_drafts`,
    );
    expect(types).toEqual({ b: "object", s: "object", p: "object", v: "array", r: "object", g: "object" });
    expect(await auditActions(sql, run.id)).toContain("run.materialized");
  });

  it("só produz a partir de um corte SELECIONADO, do próprio dono e com plataformas no projeto", async () => {
    const media = await createSampleMedia(sql, userId, projectId);
    const orch = mockOrchestrator();
    await orch.createRun({ userId, projectId, pipeline: "analise_midia", input: { media_id: media.id } });
    await orch.drain(10);
    const clip = (await listClipCandidates(sql, userId, media.id))[0];
    await expect(orch.createRun({ userId, projectId, pipeline: "producao_corte", input: { clip_id: clip.id } })).rejects.toThrow(/Selecione o corte/);

    await setClipStatus(sql, userId, clip.id, "selecionado");
    const other = await createUser(sql);
    const otherProject = (await createGtaProject(sql, other)).id;
    await expect(
      orch.createRun({ userId: other, projectId: otherProject, pipeline: "producao_corte", input: { clip_id: clip.id } }),
    ).rejects.toThrow(NotFoundError);
    await expect(orch.createRun({ userId, projectId, pipeline: "producao_corte", input: { clip_id: "nao-e-id" } })).rejects.toThrow(NotFoundError);

    await sql.query(`update content_projects set platforms = '{}' where id = $1`, [projectId]);
    await expect(orch.createRun({ userId, projectId, pipeline: "producao_corte", input: { clip_id: clip.id } })).rejects.toThrow(InvalidStateError);
  });

  it("um agente que erra volta para correção e o pipeline se recupera (roteirista cita algo que não foi dito)", async () => {
    const { clip } = await selectedClip();
    class FlakyMock implements ModelProvider {
      readonly id = "mock";
      readonly capabilities = { webSearch: false, simulated: true } as const;
      private readonly inner = new MockProvider();
      scriptCalls = 0;
      async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse> {
        const res = await this.inner.generateStructured(request);
        if (request.role === "roteirista" && ++this.scriptCalls === 1) {
          const data = res.data as { beats: { quote: string | null }[] };
          data.beats[0].quote = "frase que ninguém disse";
        }
        return res;
      }
    }
    const flaky = new FlakyMock();
    const run = await produce(mockOrchestrator(flaky), clip.id);
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const script = (await taskRows(sql, run.id)).find((t) => t.agent_role === "roteirista")!;
    expect(script.corrections).toBe(1);
    expect(flaky.scriptCalls).toBe(2);
    expect(await auditActions(sql, run.id)).toContain("task.validation_failed");
  });

  it("quando o Revisor pede ajustes o rascunho é criado, mas o portão reprova", async () => {
    const { clip } = await selectedClip();
    const run = await produce(mockOrchestrator(new MockProvider("review_adjustments")), clip.id);
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const [draft] = await listDrafts(sql, userId);
    expect(draft.gate.passed).toBe(false);
    expect(draft.gate.reasons.join(" ")).toMatch(/ajustes/);
    expect(draft.status).toBe("em_revisao");
  });
});

// ------------------------------------------------------------------ decisão humana e histórico

describe("decisão humana sobre o rascunho", () => {
  async function draftOf(provider?: ModelProvider) {
    const { clip } = await selectedClip();
    await produce(mockOrchestrator(provider), clip.id);
    return (await listDrafts(sql, userId))[0];
  }

  it("rejeitar exige nota; aprovar e reabrir ficam auditados; nada é publicado", async () => {
    const draft = await draftOf();
    await expect(decideDraft(sql, userId, draft.id, "rejeitado")).rejects.toThrow(/Explique/);
    await decideDraft(sql, userId, draft.id, "rejeitado", { note: "O gancho está fraco." });
    expect((await getDraft(sql, userId, draft.id))?.status).toBe("rejeitado");
    await decideDraft(sql, userId, draft.id, "em_revisao");
    await decideDraft(sql, userId, draft.id, "aprovado", { note: "Ok para gravar." });
    const approved = await getDraft(sql, userId, draft.id);
    expect(approved).toMatchObject({ status: "aprovado", decided_by: "user", decision_note: "Ok para gravar." });
    const events = await sql.query<{ data: { from: string; to: string; forced: boolean } }>(
      `select data from audit_events where action = 'draft.decided' order by id`,
    );
    expect(events.map((e) => [e.data.from, e.data.to])).toEqual([
      ["em_revisao", "rejeitado"],
      ["rejeitado", "em_revisao"],
      ["em_revisao", "aprovado"],
    ]);
    expect(events.every((e) => e.data.forced === false)).toBe(true);
  });

  it("aprovar um rascunho reprovado pelo portão exige confirmação explícita, registrada como forçada", async () => {
    const draft = await draftOf(new MockProvider("review_adjustments"));
    expect(draft.gate.passed).toBe(false);
    await expect(decideDraft(sql, userId, draft.id, "aprovado")).rejects.toThrow(/aprovar mesmo assim/);
    expect((await getDraft(sql, userId, draft.id))?.status).toBe("em_revisao");
    await decideDraft(sql, userId, draft.id, "aprovado", { force: true, note: "Vou ajustar na gravação." });
    const [event] = await sql.query<{ data: { forced: boolean; gate_passed: boolean } }>(
      `select data from audit_events where action = 'draft.decided'`,
    );
    expect(event.data).toMatchObject({ forced: true, gate_passed: false });
  });

  it("outro usuário não vê nem decide o rascunho", async () => {
    const draft = await draftOf();
    const other = await createUser(sql);
    await expect(decideDraft(sql, other, draft.id, "aprovado")).rejects.toThrow(NotFoundError);
    expect(await getDraft(sql, other, draft.id)).toBeNull();
    expect(await listDrafts(sql, other)).toHaveLength(0);
  });
});

describe("fluxo completo da Central de Conteúdo (demonstração)", () => {
  it("projeto → material → análise → candidatos → seleção → produção → revisão → aprovação → histórico", async () => {
    // 1–2. projeto (criado no beforeEach, agora com duas plataformas) e material de exemplo na biblioteca
    await sql.query(`update content_projects set platforms = array['instagram_reels', 'tiktok'] where id = $1`, [projectId]);
    const media = await createSampleMedia(sql, userId, projectId);
    // 3–5. análise com candidatos: título, justificativa, tempos e pontuação
    const orch = mockOrchestrator();
    await orch.createRun({ userId, projectId, pipeline: "analise_midia", input: { media_id: media.id } });
    await orch.drain(10);
    const clips = await listClipCandidates(sql, userId, media.id);
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.justification.length).toBeGreaterThan(0);
      expect(Number(c.end_s)).toBeGreaterThan(Number(c.start_s));
      expect(c.score).toBeGreaterThanOrEqual(0);
    }
    // 6. seleção
    await setClipStatus(sql, userId, clips[0].id, "selecionado");
    // 7–8. roteiro e metadados por plataforma, encaminhados à revisão
    await produce(orch, clips[0].id);
    const [draft] = await listDrafts(sql, userId);
    expect(draft.status).toBe("em_revisao");
    expect(draft.platform_versions.map((v) => v.platform).sort()).toEqual(["instagram_reels", "tiktok"]);
    // 9. aprovação
    await decideDraft(sql, userId, draft.id, "aprovado");
    // 10. histórico salvo
    const actions = (await sql.query<{ action: string }>(`select action from audit_events where owner_id = $1 order by id`, [userId])).map((r) => r.action);
    for (const expected of ["media.created", "run.created", "clip.status_changed", "run.materialized", "draft.decided"]) {
      expect(actions).toContain(expected);
    }
    expect(actions.indexOf("media.created")).toBeLessThan(actions.indexOf("clip.status_changed"));
    expect(actions.lastIndexOf("draft.decided")).toBe(actions.length - 1);
    // Nada real: tudo simulado, nenhuma fonte registrada, nenhum arquivo gerado.
    expect(draft.simulated).toBe(true);
    const [{ n }] = await sql.query<{ n: string }>(`select count(*)::text as n from source_records`);
    expect(Number(n)).toBe(0);
  });
});

describe("RLS de clip_drafts", () => {
  it("o dono lê; outro usuário e anônimo não; o cliente não escreve", async () => {
    const { clip } = await selectedClip();
    await produce(mockOrchestrator(), clip.id);
    const other = await createUser(sql);
    const asUser = async <T>(uid: string, fn: () => Promise<T>): Promise<T> => {
      await raw.exec(`set role authenticated`);
      await raw.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      try {
        return await fn();
      } finally {
        await raw.exec(`reset role`);
      }
    };
    expect(await asUser(userId, async () => (await raw.query(`select id from clip_drafts`)).rows)).toHaveLength(1);
    expect(await asUser(other, async () => (await raw.query(`select id from clip_drafts`)).rows)).toHaveLength(0);
    await asUser(userId, async () => {
      await expect(raw.query(`update clip_drafts set status = 'aprovado'`)).rejects.toThrow(/permission denied/);
      await expect(raw.query(`delete from clip_drafts`)).rejects.toThrow(/permission denied/);
    });
    await raw.exec(`set role anon`);
    try {
      await expect(raw.query(`select * from clip_drafts`)).rejects.toThrow(/permission denied/);
    } finally {
      await raw.exec(`reset role`);
    }
  });
});
