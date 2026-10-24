import {
  ConnectorError,
  type ModelProvider,
  type RetrievedSource,
  type StructuredRequest,
  type StructuredResponse,
} from "../types";
import {
  assertInputSize,
  intFromEnv,
  knownAsRetrieved,
  noSearchInstruction,
  parseJsonLoose,
  redactSecrets,
  retryAfterSeconds,
  schemaInstruction,
} from "./shared";

/**
 * Adaptador da API oficial do Google Gemini (REST `generateContent`, chave em header, só no servidor/worker).
 * O modelo padrão é uma suposição e JÁ se mostrou indisponível para contas novas (404 em generateContent, mesmo
 * existindo em models.get): use "Testar conexão" para listar os modelos da sua chave e defina GEMINI_MODEL. Os limites do plano gratuito mudam e são
 * por projeto do Google: confira os valores atuais no AI Studio (os números daqui não são garantidos).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}
export function hasGeminiCredential(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
/** Busca do Google (grounding): só quando ligada explicitamente, pois pode não existir ou ser paga no seu plano. */
export function geminiGroundingEnabled(): boolean {
  return process.env.GEMINI_GROUNDING === "on";
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  grounding?: boolean;
  maxRequestsPerMinute?: number;
  maxOutputTokens?: number;
}

/** Janela deslizante por processo: protege o limite por minuto sem dormir dentro da função serverless. */
const recentCalls: number[] = [];

/** Só para testes: zera a janela do limitador local. */
export function resetGeminiRateLimiter(): void {
  recentCalls.length = 0;
}

interface GeminiResponseBody {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[]; webSearchQueries?: string[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
}

interface GeminiErrorBody {
  error?: { code?: number; message?: string; status?: string; details?: { "@type"?: string; violations?: { quotaId?: string }[]; retryDelay?: string }[] };
}

export class GeminiProvider implements ModelProvider {
  readonly id = "gemini";
  readonly capabilities;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly grounding: boolean;
  private readonly rpm: number;
  private readonly maxOutputTokens: number;

  constructor(opts: GeminiOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ConnectorError("pending_credential", "Gemini sem credencial: configure GEMINI_API_KEY no servidor/worker.", false);
    }
    this.apiKey = apiKey;
    this.model = opts.model ?? geminiModel();
    this.baseUrl = (opts.baseUrl ?? process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.grounding = opts.grounding ?? geminiGroundingEnabled();
    this.rpm = opts.maxRequestsPerMinute ?? intFromEnv("GEMINI_MAX_RPM", 5);
    this.maxOutputTokens = opts.maxOutputTokens ?? intFromEnv("GEMINI_MAX_OUTPUT_TOKENS", 8192);
    this.capabilities = { webSearch: this.grounding, simulated: false } as const;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse> {
    assertInputSize(request, "o Gemini");
    this.reserveSlot();

    const useSearch = Boolean(request.webSearch) && this.grounding;
    const prompt =
      request.prompt + (request.webSearch && !useSearch ? noSearchInstruction(request) : "") + schemaInstruction(request.schema);
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: this.maxOutputTokens,
        // JSON nativo não combina com a ferramenta de busca; nesse caso o formato vem da instrução no prompt.
        ...(useSearch ? {} : { responseMimeType: "application/json" }),
      },
      ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
    };

    // A duração fica a cargo do orquestrador (agent_tasks.duration_ms); o uso por chamada vai em `usage`.
    const response = await this.post(`/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, body);
    const candidate = response.candidates?.[0];
    if (response.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
      throw new ConnectorError("refusal", "O Gemini bloqueou a requisição por política de segurança.", false, {
        reason: response.promptFeedback?.blockReason ?? candidate?.finishReason ?? null,
      });
    }
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new ConnectorError("truncated", "Resposta do Gemini cortada pelo limite de tokens de saída.", true);
    }
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");

    const retrieved: RetrievedSource[] = useSearch
      ? (candidate?.groundingMetadata?.groundingChunks ?? [])
          .filter((c) => c.web?.uri)
          .map((c) => ({ url: c.web!.uri!, title: c.web!.title ?? c.web!.uri!, page_age: null }))
      : knownAsRetrieved(request);

    return {
      data: parseJsonLoose(text),
      retrievedSources: retrieved,
      usage: [
        {
          provider: "gemini",
          model: response.modelVersion ?? this.model,
          input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
          cache_read_input_tokens: 0,
          web_search_requests: useSearch && (candidate?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0 ? 1 : 0,
        },
      ],
    };
  }

  /** Garante o limite por minuto sem esperar: se estourar, o orquestrador reagenda com backoff. */
  private reserveSlot(): void {
    const now = Date.now();
    while (recentCalls.length && now - recentCalls[0] > 60_000) recentCalls.shift();
    if (recentCalls.length >= this.rpm) {
      const wait = Math.ceil((60_000 - (now - recentCalls[0])) / 1000);
      throw new ConnectorError(
        "rate_limited",
        `Limite local de ${this.rpm} requisições por minuto ao Gemini (GEMINI_MAX_RPM); tente de novo em ${wait}s.`,
        true,
        { retry_after_seconds: wait, local: true },
      );
    }
    recentCalls.push(now);
  }

  private async post(path: string, body: unknown): Promise<GeminiResponseBody> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(intFromEnv("GEMINI_TIMEOUT_MS", 60_000)),
      });
    } catch (error) {
      throw new ConnectorError("unavailable", `Gemini indisponível: ${redactSecrets(error instanceof Error ? error.message : String(error))}`, true);
    }
    if (!res.ok) throw await this.toError(res);
    try {
      return (await res.json()) as GeminiResponseBody;
    } catch {
      throw new ConnectorError("unavailable", "O Gemini devolveu uma resposta ilegível.", true);
    }
  }

  private async toError(res: Response): Promise<ConnectorError> {
    const parsed = (await res.json().catch(() => ({}))) as GeminiErrorBody;
    const message = redactSecrets(parsed.error?.message ?? res.statusText ?? "erro desconhecido");
    if (res.status === 401 || res.status === 403 || /api key not valid|api_key_invalid/i.test(message)) {
      return new ConnectorError("authentication", `Credencial do Gemini recusada (${res.status}). Confira GEMINI_API_KEY.`, false);
    }
    if (res.status === 429) {
      const violations = (parsed.error?.details ?? []).flatMap((d) => d.violations ?? []);
      const perDay = violations.some((v) => /perday/i.test(v.quotaId ?? ""));
      if (perDay) {
        return new ConnectorError(
          "quota_exhausted",
          "Limite diário do plano gratuito do Gemini esgotado. Aguarde a renovação (meia-noite, horário do Pacífico) ou mude manualmente para o modo de demonstração.",
          false,
        );
      }
      const delay = (parsed.error?.details ?? []).map((d) => d.retryDelay).find(Boolean);
      const retryAfter = retryAfterSeconds(res.headers.get("retry-after")) ?? (delay ? Number.parseFloat(delay) : null);
      return new ConnectorError("rate_limited", "Limite de requisições do Gemini atingido.", true, { retry_after_seconds: retryAfter });
    }
    if (res.status >= 500) return new ConnectorError("unavailable", `Gemini indisponível (${res.status}).`, true);
    if (res.status === 404) {
      return new ConnectorError(
        "bad_request",
        `Modelo ${this.model} indisponível para esta chave (404). Em Configurações, "Testar conexão" lista os modelos que a chave pode usar; defina um deles em GEMINI_MODEL. Resposta da API: ${message}`,
        false,
        { model: this.model },
      );
    }
    return new ConnectorError("bad_request", `Requisição inválida ao Gemini (${res.status}): ${message}`, false);
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  code: "ok" | "pending_credential" | "authentication" | "bad_request" | "rate_limited" | "quota_exhausted" | "unavailable";
  message: string;
  model: string;
  /** Modelos que aceitam generateContent para esta chave (priorizando flash/lite). Vazio se não foi possível listar. */
  models: string[];
}

const MAX_LISTED_MODELS = 12;

/**
 * Valida a credencial E o uso real do modelo: consultar só os metadados (`models.get`) não basta, porque um modelo
 * pode existir na listagem e ser recusado em `generateContent` (ex.: "não está mais disponível para novos usuários").
 * Faz UMA geração mínima (poucos tokens, 1 requisição do plano gratuito) e lista os modelos que a chave pode usar.
 */
export async function testGeminiConnection(opts: { fetch?: FetchLike } = {}): Promise<ConnectionTestResult> {
  const model = geminiModel();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, code: "pending_credential", message: "GEMINI_API_KEY não configurada.", model, models: [] };
  const base = (process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const headers = { "x-goog-api-key": apiKey };
  const net = (error: unknown) =>
    ({
      ok: false,
      code: "unavailable",
      message: redactSecrets(`Falha de rede: ${error instanceof Error ? error.message : String(error)}`),
      model,
      models: [],
    }) satisfies ConnectionTestResult;

  // 1) Lista os modelos utilizáveis (também serve para validar a chave).
  let models: string[] = [];
  try {
    const res = await doFetch(`${base}/v1beta/models?pageSize=200`, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      return { ok: false, code: "authentication", message: `Credencial recusada (${res.status}).`, model, models: [] };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
      const usable = (body.models ?? [])
        .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) => m.name!.replace(/^models\//, ""))
        .filter((n) => n.startsWith("gemini"));
      const rank = (n: string) => (/flash/.test(n) ? 0 : /lite/.test(n) ? 1 : 2);
      models = [...new Set(usable)].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a)).slice(0, MAX_LISTED_MODELS);
    }
  } catch (error) {
    return net(error);
  }

  // 2) Geração mínima com o modelo configurado.
  try {
    const res = await doFetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Responda apenas: ok" }] }],
        generationConfig: { maxOutputTokens: 16, temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      return { ok: true, code: "ok", message: `Credencial aceita e o modelo ${model} respondeu a uma geração mínima.`, model, models };
    }
    const err = (await res.json().catch(() => ({}))) as GeminiErrorBody;
    const detail = redactSecrets(err.error?.message ?? res.statusText ?? "");
    const hint = models.length ? ` Modelos disponíveis para esta chave: ${models.join(", ")}.` : "";
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: "authentication", message: `Credencial recusada (${res.status}).`, model, models };
    }
    if (res.status === 404) {
      return { ok: false, code: "bad_request", message: `O modelo ${model} não pode ser usado por esta chave (404). Defina GEMINI_MODEL com outro modelo.${hint} Resposta da API: ${detail}`, model, models };
    }
    if (res.status === 429) {
      const perDay = (err.error?.details ?? []).flatMap((d) => d.violations ?? []).some((v) => /perday/i.test(v.quotaId ?? ""));
      return perDay
        ? { ok: false, code: "quota_exhausted", message: "Limite diário do plano gratuito esgotado. Aguarde a renovação ou use o modo de demonstração.", model, models }
        : { ok: false, code: "rate_limited", message: "Limite por minuto atingido; a credencial está válida. Tente de novo em instantes.", model, models };
    }
    if (res.status >= 500) return { ok: false, code: "unavailable", message: `Gemini respondeu ${res.status}.`, model, models };
    return { ok: false, code: "bad_request", message: `Requisição recusada (${res.status}): ${detail}${hint}`, model, models };
  } catch (error) {
    return { ...net(error), models };
  }
}
