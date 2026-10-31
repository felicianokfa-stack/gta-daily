import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { analistaConteudo } from "@/agents/analista-conteudo";
import { createProviderFactory } from "@/connectors/ai/factory";
import { MockProvider } from "@/connectors/ai/mock";
import { ContentAnalysisInput, ContentAnalysisResult, MediaAuthorization } from "@/core/contracts/content";
import { SAMPLE_MEDIA } from "@/core/sample-media";
import {
  TranscriptParseError,
  formatTimestamp,
  parseTimestamp,
  parseTranscriptText,
} from "@/core/transcript";
import type { Sql } from "@/db/sql";
import { InvalidStateError, NotFoundError, Orchestrator } from "@/orchestrator/engine";
import {
  createMedia,
  createSampleMedia,
  getMedia,
  listClipCandidates,
  listMedia,
  setClipStatus,
  type NewMediaInput,
} from "@/orchestrator/queries";
import { ScriptedProvider, auditActions, createGtaProject, createUser, orchestrator, runStatus, setupDb, taskRows } from "./helpers";

let sql: Sql;
let raw: PGlite;
let userId: string;
let projectId: string;

beforeEach(async () => {
  ({ sql, raw } = await setupDb());
  userId = await createUser(sql);
  projectId = (await createGtaProject(sql, userId)).id;
});

const TRANSCRIPT = `0:00 Abertura do vídeo de teste.
0:20 Segundo trecho com uma ideia completa.
0:45 Terceiro trecho que fecha o raciocínio.
1:10 Encerramento.`;

const mediaInput = (over: Partial<NewMediaInput> = {}): NewMediaInput => ({
  projectId,
  kind: "transcricao",
  title: "Material de teste",
  url: "",
  duration: "1:30",
  transcript_text: TRANSCRIPT,
  notes: "",
  authorized: true,
  authorization_basis: "Vídeo do meu próprio canal",
  ...over,
});

describe("transcrição com marcações de tempo", () => {
  it("interpreta tempos de início e fecha cada trecho no início do próximo", () => {
    const seg = parseTranscriptText(TRANSCRIPT, 90);
    expect(seg.map((s) => [s.id, s.start_s, s.end_s])).toEqual([
      [1, 0, 20],
      [2, 20, 45],
      [3, 45, 70],
      [4, 70, 90],
    ]);
  });

  it("aceita h:mm:ss, colchetes e separadores, e rejeita formato, ordem e duração inválidos", () => {
    expect(parseTranscriptText("[0:00] - Um\n0:10 — Dois\n1:00:00 Três", 4000).map((s) => s.start_s)).toEqual([0, 10, 3600]);
    expect(() => parseTranscriptText("sem tempo aqui", 60)).toThrow(TranscriptParseError);
    expect(() => parseTranscriptText("   \n", 60)).toThrow(TranscriptParseError);
    expect(() => parseTranscriptText("0:30 A\n0:10 B", 60)).toThrow(/Marcações de tempo inválidas/);
    expect(() => parseTranscriptText("0:00 A\n2:00 B", 60)).toThrow(/Marcações de tempo inválidas/);
  });

  it("converte e formata tempos", () => {
    expect(parseTimestamp("2:30")).toBe(150);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("1:75")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });
});

describe("biblioteca de materiais", () => {
  it("só salva com a autorização declarada e uma base descrita", async () => {
    await expect(createMedia(sql, userId, mediaInput({ authorized: false }))).rejects.toThrow(/autorização/i);
    await expect(createMedia(sql, userId, mediaInput({ authorization_basis: "" }))).rejects.toThrow();
    expect(MediaAuthorization.safeParse({ declared: false, basis: "x".repeat(5) }).success).toBe(false);
    expect(await listMedia(sql, userId)).toHaveLength(0);
  });

  it("valida link, duração e projeto do dono", async () => {
    await expect(createMedia(sql, userId, mediaInput({ kind: "link", url: "" }))).rejects.toThrow(TranscriptParseError);
    await expect(createMedia(sql, userId, mediaInput({ kind: "link", url: "ftp://exemplo.com/x" }))).rejects.toThrow(/http/);
    await expect(createMedia(sql, userId, mediaInput({ duration: "abc" }))).rejects.toThrow(/Duração inválida/);
    const other = await createUser(sql);
    await expect(createMedia(sql, other, mediaInput())).rejects.toThrow(NotFoundError);
  });

  it("grava transcrição e autorização como objetos jsonb, registra auditoria e não baixa nada", async () => {
    const media = await createMedia(sql, userId, mediaInput({ kind: "link", url: "https://exemplo.com/video" }));
    expect(media.url).toBe("https://exemplo.com/video");
    const [types] = await sql.query<{ t: string; a: string }>(
      `select jsonb_typeof(transcript) as t, jsonb_typeof(usage_rights) as a from media_items where id = $1`,
      [media.id],
    );
    expect(types).toEqual({ t: "array", a: "object" });
    const [event] = await sql.query<{ action: string; data: { media_id: string } }>(
      `select action, data from audit_events where action = 'media.created'`,
    );
    expect(event.data.media_id).toBe(media.id);
    expect((await getMedia(sql, userId, media.id))?.transcript).toHaveLength(4);
  });

  it("o material de exemplo é fictício, marcado e autorizado", async () => {
    const media = await createSampleMedia(sql, userId, projectId);
    expect(media).toMatchObject({ kind: "exemplo", is_sample: true, url: null });
    expect(media.title).toContain("FICTÍCIO");
    expect(media.usage_rights.declared).toBe(true);
    expect(media.transcript.length).toBeGreaterThan(5);
    expect(SAMPLE_MEDIA.transcript_text).toMatch(/fictício|inventad/i);
  });
});

function input(over: Partial<ContentAnalysisInput> = {}): ContentAnalysisInput {
  return ContentAnalysisInput.parse({
    media_id: "00000000-0000-4000-8000-000000000001",
    title: "Teste",
    kind: "transcricao",
    duration_seconds: 90,
    transcript: parseTranscriptText(TRANSCRIPT, 90),
    niche_id: "gta-vi",
    ...over,
  });
}
const candidate = (over: Record<string, unknown> = {}) => ({
  title: "Corte bom",
  justification: "O trecho traz uma ideia completa e fácil de entender.",
  start_s: 20,
  end_s: 70,
  segment_ids: [2, 3],
  score: { value: 70, reason: "Gancho claro e trecho completo." },
  risks: [],
  ...over,
});
const result = (candidates: unknown[], unknowns: string[] = []) =>
  ContentAnalysisResult.parse({ summary: "Resumo.", topics: ["tema"], candidates, unknowns });

describe("Analista de Conteúdo: validação de negócio", () => {
  it("aceita um corte coerente com a transcrição", () => {
    const v = analistaConteudo.validate(input(), result([candidate()]), []);
    expect(v.errors).toEqual([]);
  });

  it.each([
    ["tempo fora da transcrição", candidate({ start_s: 80, end_s: 200 }), /fora da transcrição/],
    ["segmento inexistente", candidate({ segment_ids: [2, 99] }), /inexistentes/],
    ["tempos que não batem com os segmentos", candidate({ start_s: 0, end_s: 30 }), /não coincidem/],
    ["corte curto demais", candidate({ start_s: 20, end_s: 22, segment_ids: [2] }), /fora do intervalo/],
    ["fim antes do início", candidate({ start_s: 50, end_s: 40 }), /precisa ser maior/],
    ["promessa de viralização", candidate({ score: { value: 90, reason: "Tem alta probabilidade de viralizar." } }), /promete resultado/],
  ])("rejeita: %s", (_name, bad, pattern) => {
    const v = analistaConteudo.validate(input(), result([bad as never]), []);
    expect(v.errors.join(" ")).toMatch(pattern);
  });

  it("exige explicação quando não há cortes e avisa sobre material de exemplo", () => {
    expect(analistaConteudo.validate(input(), result([]), []).errors.join(" ")).toMatch(/unknowns/);
    const ok = analistaConteudo.validate(input({ is_sample: true }), result([], ["Material curto demais."]), []);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings.join(" ")).toMatch(/exemplo fictício/);
  });
});

async function runAnalysis(orch: Orchestrator, mediaId: string) {
  const { run } = await orch.createRun({ userId, projectId, pipeline: "analise_midia", input: { media_id: mediaId } });
  await orch.drain(10);
  return run;
}

describe("pipeline analise_midia", () => {
  it("com o provedor de demonstração gera candidatos simulados, sem tocar fontes reais", async () => {
    const media = await createSampleMedia(sql, userId, projectId);
    const orch = new Orchestrator({ sql, providerFactory: () => new MockProvider(), workerId: "t" });
    const run = await runAnalysis(orch, media.id);
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const clips = await listClipCandidates(sql, userId, media.id);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.every((c) => c.simulated && c.status === "sugerido")).toBe(true);
    expect(clips[0].title).toContain("[SIMULADO]");
    for (const c of clips) {
      expect(Number(c.end_s)).toBeGreaterThan(Number(c.start_s));
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
    const [task] = await taskRows(sql, run.id);
    expect(task).toMatchObject({ agent_role: "analista_conteudo", status: "succeeded" });
    const [meta] = await sql.query<{ provider: string; input: string; output: string; usage: string }>(
      `select provider, jsonb_typeof(input) as input, jsonb_typeof(output) as output, jsonb_typeof(usage) as usage from agent_tasks where run_id = $1`,
      [run.id],
    );
    expect(meta).toEqual({ provider: "mock", input: "object", output: "object", usage: "array" });
    const [{ n }] = await sql.query<{ n: string }>(`select count(*)::text as n from source_records`);
    expect(Number(n)).toBe(0);
    expect(await auditActions(sql, run.id)).toContain("run.materialized");
  });

  it("é determinístico: a mesma transcrição gera os mesmos candidatos", async () => {
    const media = await createSampleMedia(sql, userId, projectId);
    const a = await new MockProvider().generateStructured({
      system: "s",
      prompt: "p",
      schema: ContentAnalysisResult,
      effort: "low",
      role: "analista_conteudo",
      input: { title: media.title, transcript: media.transcript },
    });
    const b = await new MockProvider().generateStructured({
      system: "s",
      prompt: "p",
      schema: ContentAnalysisResult,
      effort: "low",
      role: "analista_conteudo",
      input: { title: media.title, transcript: media.transcript },
    });
    expect(a.data).toEqual(b.data);
  });

  it("funciona escolhendo o provedor por AI_PROVIDER, sem nenhuma chave de IA", async () => {
    const saved = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const media = await createSampleMedia(sql, userId, projectId);
      const orch = new Orchestrator({ sql, providerFactory: createProviderFactory(), workerId: "t" });
      const run = await runAnalysis(orch, media.id);
      expect(await runStatus(sql, run.id)).toBe("succeeded");
    } finally {
      if (saved === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = saved;
    }
  });

  it("um provedor real (roteirizado) grava candidatos NÃO simulados e o ciclo de correção barra tempos inválidos", async () => {
    const media = await createSampleMedia(sql, userId, projectId);
    const segs = media.transcript;
    const good = {
      summary: "Resumo real de teste.",
      topics: ["tema"],
      candidates: [
        {
          title: "Corte real",
          justification: "Trecho completo.",
          start_s: segs[0].start_s,
          end_s: segs[2].end_s,
          segment_ids: [segs[0].id, segs[1].id, segs[2].id],
          score: { value: 66, reason: "Gancho claro." },
          risks: [],
        },
      ],
      unknowns: [],
    };
    const bad = { ...good, candidates: [{ ...good.candidates[0], start_s: 9999, end_s: 10_100 }] };
    const provider = new ScriptedProvider().ok(bad).ok(good);
    const orch = orchestrator(sql, provider);
    const run = await runAnalysis(orch, media.id);
    expect(await runStatus(sql, run.id)).toBe("succeeded");
    const [task] = await taskRows(sql, run.id);
    expect(task.corrections).toBe(1);
    expect(await auditActions(sql, run.id)).toContain("task.validation_failed");
    const clips = await listClipCandidates(sql, userId, media.id);
    expect(clips).toHaveLength(1);
    expect(clips[0].simulated).toBe(false);
  });

  it("recusa material de outro usuário e material sem autorização declarada", async () => {
    const media = await createSampleMedia(sql, userId, projectId);
    const other = await createUser(sql);
    const otherProject = (await createGtaProject(sql, other)).id;
    const orch = orchestrator(sql, new ScriptedProvider());
    await expect(
      orch.createRun({ userId: other, projectId: otherProject, pipeline: "analise_midia", input: { media_id: media.id } }),
    ).rejects.toThrow(NotFoundError);
    await expect(orch.createRun({ userId, projectId, pipeline: "analise_midia", input: { media_id: "nao-e-um-id" } })).rejects.toThrow(NotFoundError);
    await sql.query(`update media_items set usage_rights = '{"declared": false, "basis": "x"}'::jsonb where id = $1`, [media.id]);
    await expect(orch.createRun({ userId, projectId, pipeline: "analise_midia", input: { media_id: media.id } })).rejects.toThrow(InvalidStateError);
  });

  it("o pipeline de pesquisa continua montando a entrada com nicho e fontes conhecidas", async () => {
    const orch = orchestrator(sql, new ScriptedProvider());
    const { run } = await orch.createRun({ userId, projectId, pipeline: "pesquisa_verificacao", input: { topic: "Tema qualquer" } });
    expect(run.input).toMatchObject({ topic: "Tema qualquer", niche_id: "gta-vi", known_sources: [] });
  });
});

describe("decisão sobre os cortes", () => {
  async function oneClip() {
    const media = await createSampleMedia(sql, userId, projectId);
    const orch = new Orchestrator({ sql, providerFactory: () => new MockProvider(), workerId: "t" });
    await runAnalysis(orch, media.id);
    return { media, clip: (await listClipCandidates(sql, userId, media.id))[0] };
  }

  it("selecionar, descartar e reabrir ficam auditados, e outro usuário não consegue decidir", async () => {
    const { clip } = await oneClip();
    await setClipStatus(sql, userId, clip.id, "selecionado");
    await setClipStatus(sql, userId, clip.id, "descartado");
    const events = await sql.query<{ data: { from: string; to: string } }>(
      `select data from audit_events where action = 'clip.status_changed' order by id`,
    );
    expect(events.map((e) => [e.data.from, e.data.to])).toEqual([
      ["sugerido", "selecionado"],
      ["selecionado", "descartado"],
    ]);
    const other = await createUser(sql);
    await expect(setClipStatus(sql, other, clip.id, "selecionado")).rejects.toThrow(NotFoundError);
  });
});

describe("RLS das tabelas da Central de Conteúdo", () => {
  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await raw.exec(`set role authenticated`);
    await raw.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    try {
      return await fn();
    } finally {
      await raw.exec(`reset role`);
    }
  }

  it("cada usuário só lê o que é seu e o cliente não escreve nem lê como anônimo", async () => {
    const media = await createSampleMedia(sql, userId, projectId);
    const orch = new Orchestrator({ sql, providerFactory: () => new MockProvider(), workerId: "t" });
    await runAnalysis(orch, media.id);
    const other = await createUser(sql);

    const seenByOther = await asUser(other, async () => ({
      media: (await raw.query(`select id from media_items`)).rows,
      clips: (await raw.query(`select id from clip_candidates`)).rows,
    }));
    expect(seenByOther.media).toHaveLength(0);
    expect(seenByOther.clips).toHaveLength(0);

    const seenByOwner = await asUser(userId, async () => ({
      media: (await raw.query(`select id from media_items`)).rows,
      clips: (await raw.query(`select id from clip_candidates`)).rows,
    }));
    expect(seenByOwner.media).toHaveLength(1);
    expect(seenByOwner.clips.length).toBeGreaterThan(0);

    await asUser(userId, async () => {
      await expect(raw.query(`update clip_candidates set status = 'selecionado'`)).rejects.toThrow(/permission denied/);
      await expect(raw.query(`delete from media_items`)).rejects.toThrow(/permission denied/);
      await expect(
        raw.query(
          `insert into media_items (project_id, owner_id, kind, title, duration_seconds, transcript, usage_rights) values ($1, $2, 'link', 'x', 10, '[]'::jsonb, '{}'::jsonb)`,
          [projectId, userId],
        ),
      ).rejects.toThrow(/permission denied/);
    });

    await raw.exec(`set role anon`);
    try {
      await expect(raw.query(`select * from media_items`)).rejects.toThrow(/permission denied/);
      await expect(raw.query(`select * from clip_candidates`)).rejects.toThrow(/permission denied/);
    } finally {
      await raw.exec(`reset role`);
    }
  });
});
