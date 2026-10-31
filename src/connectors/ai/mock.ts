import { createHash } from "node:crypto";
import { ConnectorError, type ModelProvider, type RetrievedSource, type StructuredRequest, type StructuredResponse } from "../types";

/**
 * Provedor de DEMONSTRAÇÃO. Não faz chamadas de rede, não pesquisa nada e não verifica nada:
 * tudo o que devolve é fictício, determinístico e marcado com "[SIMULADO]".
 * Serve para validar orquestração, contratos, portões, histórico e interface sem custo.
 * As fontes usam o domínio reservado `.invalid`, que não existe na internet.
 */
export type MockScenario = "ok" | "invalid_schema" | "rate_limited" | "contradiction" | "review_adjustments";

export const SIMULATED_TAG = "[SIMULADO]";

export function mockScenarioFromEnv(): MockScenario {
  const v = process.env.MOCK_SCENARIO;
  return v === "invalid_schema" || v === "rate_limited" || v === "contradiction" || v === "review_adjustments" ? v : "ok";
}

function seed(text: string): number {
  return createHash("sha1").update(text).digest().readUInt16BE(0);
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tema";
}

function fakeSources(topic: string): RetrievedSource[] {
  const s = slug(topic);
  return [
    { url: `https://fonte-a.exemplo.invalid/${s}`, title: `${SIMULATED_TAG} Fonte fictícia A — ${topic}`.slice(0, 300), page_age: null },
    { url: `https://fonte-b.exemplo.invalid/${s}`, title: `${SIMULATED_TAG} Fonte fictícia B — ${topic}`.slice(0, 300), page_age: null },
  ];
}

function asSegments(value: unknown): { id: number; start_s: number; end_s: number; text: string }[] {
  return (Array.isArray(value) ? value : []) as { id: number; start_s: number; end_s: number; text: string }[];
}

const USAGE = (model: string) => ({
  provider: "mock",
  model,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  web_search_requests: 0,
});

export class MockProvider implements ModelProvider {
  readonly id = "mock";
  readonly capabilities = { webSearch: false, simulated: true } as const;
  private calls = 0;

  constructor(private readonly scenario: MockScenario = "ok") {}

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse> {
    this.calls += 1;
    if (this.scenario === "rate_limited" && this.calls === 1) {
      throw new ConnectorError("rate_limited", `${SIMULATED_TAG} Limite de requisições simulado.`, true);
    }
    if (this.scenario === "invalid_schema" && this.calls === 1) {
      return { data: { resposta: `${SIMULATED_TAG} saída fora do contrato` }, retrievedSources: [], usage: [USAGE("mock-1")] };
    }
    const input = (request.input ?? {}) as Record<string, unknown>;
    if (request.role === "pesquisador") return this.research(input);
    if (request.role === "verificador") return this.verify(input);
    if (request.role === "analista_conteudo") return this.analyzeContent(input);
    if (request.role === "estrategista") return this.strategy(input);
    if (request.role === "roteirista") return this.script(input);
    if (request.role === "produtor_audiovisual") return this.productionPlan(input);
    if (request.role === "distribuidor") return this.distribution(input);
    if (request.role === "revisor_qualidade") return this.review();
    throw new ConnectorError(
      "bad_request",
      `${SIMULATED_TAG} O modo de demonstração ainda não tem resposta para o papel "${request.role ?? "desconhecido"}".`,
      false,
    );
  }

  private research(input: Record<string, unknown>): StructuredResponse {
    const topic = String(input.topic ?? "tema de teste");
    const sources = fakeSources(topic);
    const n = seed(topic);
    const data = {
      topic,
      summary: `${SIMULATED_TAG} Resumo fictício sobre «${topic}». Nenhuma pesquisa real foi feita: este texto existe só para testar o fluxo.`,
      sources: sources.map((s) => ({ url: s.url, title: s.title, publisher: "Fonte fictícia", published_at: null })),
      claims_to_verify: [
        { claim: `${SIMULATED_TAG} Alegação fictícia 1 sobre «${topic}»`, source_urls: sources.map((s) => s.url), initial_label: "hipotese" },
        { claim: `${SIMULATED_TAG} Alegação fictícia 2 sobre «${topic}»`, source_urls: [sources[1].url], initial_label: "rumor" },
      ],
      unknowns: ["Modo de demonstração: nenhuma pesquisa real foi feita; fontes e alegações são fictícias."],
      relevance: { score: 50 + (n % 41), reason: `${SIMULATED_TAG} Valor de teste, não é avaliação editorial real.` },
    };
    return { data, retrievedSources: sources, usage: [USAGE("mock-pesquisador-1")] };
  }

  /** Papéis de produção: respostas curtas, derivadas só do corte recebido (nada de conteúdo real). */
  private strategy(input: Record<string, unknown>): StructuredResponse {
    const segments = asSegments(input.segments);
    const platforms = (Array.isArray(input.platforms) ? input.platforms : ["instagram_reels"]) as string[];
    const data = {
      angle: `${SIMULATED_TAG} Ângulo de teste para «${String(input.title ?? "corte")}»`.slice(0, 300),
      hook: `${SIMULATED_TAG} Gancho de teste para os primeiros segundos.`,
      audience: `${SIMULATED_TAG} Público de teste.`,
      key_messages: segments.slice(0, 2).map((seg, i) => ({
        text: `${SIMULATED_TAG} Mensagem de teste ${i + 1} (sem valor editorial real).`,
        label: i === 0 ? "hipotese" : "nao_verificado",
        segment_ids: [seg.id],
      })),
      cta: `${SIMULATED_TAG} Pergunte ao público o que ele acha.`,
      platform_priority: platforms,
      cautions: [`${SIMULATED_TAG} Conferir o contexto antes de usar; nada aqui foi verificado.`],
    };
    return { data, retrievedSources: [], usage: [USAGE("mock-estrategista-1")] };
  }

  private script(input: Record<string, unknown>): StructuredResponse {
    const segments = asSegments(input.segments);
    const start = Number(input.start_s ?? 0);
    const end = Number(input.end_s ?? 0);
    const beats = segments
      .map((seg) => ({
        t_start: Math.max(seg.start_s, start),
        t_end: Math.min(seg.end_s, end),
        voiceover: `${SIMULATED_TAG} ${seg.text}`.slice(0, 400),
        on_screen_text: SIMULATED_TAG,
        segment_id: seg.id,
        quote: null,
      }))
      .filter((b) => b.t_end > b.t_start);
    const data = {
      beats,
      total_seconds: Math.max(1, end - start),
      disclaimers: [`${SIMULATED_TAG} Roteiro de teste montado a partir da própria transcrição; não é texto editorial real.`],
    };
    return { data, retrievedSources: [], usage: [USAGE("mock-roteirista-1")] };
  }

  private productionPlan(input: Record<string, unknown>): StructuredResponse {
    const script = (input.script ?? {}) as { beats?: { t_start: number; t_end: number; voiceover: string }[] };
    const beats = script.beats ?? [];
    const data = {
      format: "9:16",
      rendered: false,
      summary: `${SIMULATED_TAG} Plano de edição de teste. Nenhum arquivo de vídeo foi gerado.`,
      cuts: beats.map((b) => ({ t_start: b.t_start, t_end: b.t_end, framing: `${SIMULATED_TAG} Enquadramento centralizado`, note: "" })),
      subtitles: beats.map((b) => ({
        t_start: b.t_start,
        t_end: b.t_end,
        text: `${SIMULATED_TAG} ${b.voiceover.replace(SIMULATED_TAG, "").trim()}`.slice(0, 41),
      })),
      audio_notes: [`${SIMULATED_TAG} Áudio original do material, sem trilha.`],
      assets_needed: [`${SIMULATED_TAG} O arquivo de vídeo original do material (não incluído na plataforma).`],
    };
    return { data, retrievedSources: [], usage: [USAGE("mock-produtor-1")] };
  }

  private distribution(input: Record<string, unknown>): StructuredResponse {
    const platforms = (Array.isArray(input.platforms) ? input.platforms : ["instagram_reels"]) as string[];
    const data = {
      versions: platforms.map((platform) => ({
        platform,
        title: `${SIMULATED_TAG} Título de teste`,
        caption: `${SIMULATED_TAG} Legenda de teste para ${platform}. Nada foi publicado.`,
        hashtags: ["#simulado", "#exemplo"],
        cover_text: SIMULATED_TAG,
        timing_note: `${SIMULATED_TAG} Sem recomendação de horário real.`,
      })),
    };
    return { data, retrievedSources: [], usage: [USAGE("mock-distribuidor-1")] };
  }

  private review(): StructuredResponse {
    const adjustments = this.scenario === "review_adjustments";
    const rules = ["fidelidade à transcrição", "rótulos de evidência", "tempos coerentes", "plataformas completas", "sem promessas"];
    const data = {
      verdict: adjustments ? "ajustes" : "aprovado_para_revisao",
      summary: `${SIMULATED_TAG} Revisão de teste: nada foi avaliado por uma IA real.`,
      checks: rules.map((rule, i) => ({
        rule,
        passed: !(adjustments && i === 0),
        detail: `${SIMULATED_TAG} Checagem fictícia.`,
      })),
      issues: adjustments ? [`${SIMULATED_TAG} Problema fictício para testar o caminho de ajustes.`] : [],
      suggested_fixes: adjustments ? [`${SIMULATED_TAG} Correção fictícia sugerida.`] : [],
    };
    return { data, retrievedSources: [], usage: [USAGE("mock-revisor-1")] };
  }

  /** Agrupa segmentos consecutivos em até 3 cortes de ~20–60 s, sem inventar nada além do que a transcrição traz. */
  private analyzeContent(input: Record<string, unknown>): StructuredResponse {
    const transcript = (Array.isArray(input.transcript) ? input.transcript : []) as {
      id: number;
      start_s: number;
      end_s: number;
      text: string;
    }[];
    const title = String(input.title ?? "material");
    const seedBase = seed(title);
    const windows: typeof transcript[] = [];
    let current: typeof transcript = [];
    for (const seg of transcript) {
      current.push(seg);
      const length = seg.end_s - current[0].start_s;
      if (length >= 25) {
        windows.push(current);
        current = [];
      }
    }
    if (current.length > 0) {
      const length = current[current.length - 1].end_s - current[0].start_s;
      if (length >= 5 || windows.length === 0) windows.push(current);
      else windows[windows.length - 1].push(...current);
    }
    const picked = windows.filter((w) => w[w.length - 1].end_s - w[0].start_s <= 120).slice(0, 3);
    const data = {
      summary: `${SIMULATED_TAG} Resumo fictício do material «${title}». Nenhuma IA real leu a transcrição: os cortes abaixo só agrupam trechos consecutivos para testar o fluxo.`,
      topics: [`${SIMULATED_TAG} tema de teste`],
      candidates: picked.map((w, i) => ({
        title: `${SIMULATED_TAG} Corte ${i + 1}: ${w[0].text.slice(0, 60)}`.slice(0, 200),
        justification: `${SIMULATED_TAG} Trecho de ${w.length} segmento(s) seguidos, agrupado automaticamente para teste (não é avaliação editorial real).`,
        start_s: w[0].start_s,
        end_s: w[w.length - 1].end_s,
        segment_ids: w.map((s) => s.id),
        score: { value: 50 + ((seedBase + i * 7) % 41), reason: `${SIMULATED_TAG} Pontuação de teste, sem critério editorial real.` },
        risks: [`${SIMULATED_TAG} Risco de exemplo: conferir o contexto antes de usar.`],
      })),
      unknowns: [`${SIMULATED_TAG} Modo de demonstração: a transcrição não foi analisada por uma IA real.`],
    };
    return { data, retrievedSources: [], usage: [USAGE("mock-analista-1")] };
  }

  private verify(input: Record<string, unknown>): StructuredResponse {
    const research = (input.research ?? {}) as { sources?: { url: string }[]; claims_to_verify?: { claim: string; source_urls: string[] }[] };
    const sourceUrls = (research.sources ?? []).map((s) => s.url);
    const contradiction = this.scenario === "contradiction";
    const data = {
      claims: (research.claims_to_verify ?? []).map((c, i) => ({
        claim: c.claim,
        label: i === 0 ? "fato_confirmado" : "rumor",
        confidence: i === 0 ? "media" : "baixa",
        evidence_urls: i === 0 ? sourceUrls : c.source_urls,
        notes: `${SIMULATED_TAG} Classificação fictícia para teste; nada foi verificado de fato.`,
      })),
      additional_sources: [],
      contradictions: contradiction ? [`${SIMULATED_TAG} Contradição fictícia entre as fontes A e B.`] : [],
      caveats: contradiction ? [] : [`${SIMULATED_TAG} Resultado de demonstração: nada foi verificado de fato.`],
      overall: `${SIMULATED_TAG} Avaliação fictícia: use apenas para validar o fluxo da plataforma.`,
    };
    return { data, retrievedSources: sourceUrls.map((url) => ({ url, title: url, page_age: null })), usage: [USAGE("mock-verificador-1")] };
  }
}
