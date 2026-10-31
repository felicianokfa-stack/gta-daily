import { createHash } from "node:crypto";
import { ConnectorError, type ModelProvider, type RetrievedSource, type StructuredRequest, type StructuredResponse } from "../types";

/**
 * Provedor de DEMONSTRAÇÃO. Não faz chamadas de rede, não pesquisa nada e não verifica nada:
 * tudo o que devolve é fictício, determinístico e marcado com "[SIMULADO]".
 * Serve para validar orquestração, contratos, portões, histórico e interface sem custo.
 * As fontes usam o domínio reservado `.invalid`, que não existe na internet.
 */
export type MockScenario = "ok" | "invalid_schema" | "rate_limited" | "contradiction";

export const SIMULATED_TAG = "[SIMULADO]";

export function mockScenarioFromEnv(): MockScenario {
  const v = process.env.MOCK_SCENARIO;
  return v === "invalid_schema" || v === "rate_limited" || v === "contradiction" ? v : "ok";
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
