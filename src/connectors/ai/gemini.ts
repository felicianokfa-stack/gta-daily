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
 * O modelo padrão é uma suposição conservadora: confirme em https://ai.google.dev/gemini-api/docs/models quais
 * modelos têm plano gratuito e troque por GEMINI_MODEL se necessário. Os limites do plano gratuito mudam e são
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
    return new ConnectorError("bad_request", `Requisição inválida ao Gemini (${res.status}): ${message}`, false);
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  code: "ok" | "pending_credential" | "authentication" | "bad_request" | "unavailable";
  message: string;
  model: string;
}

/** Valida credencial e modelo consultando os metadados do modelo (não consome cota de geração). */
export async function testGeminiConnection(opts: { fetch?: FetchLike } = {}): Promise<ConnectionTestResult> {
  const model = geminiModel();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, code: "pending_credential", message: "GEMINI_API_KEY não configurada.", model };
  const base = (process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  try {
    const res = await doFetch(`${base}/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true, code: "ok", message: `Credencial aceita e modelo ${model} disponível.`, model };
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      return { ok: false, code: "authentication", message: `Credencial recusada (${res.status}).`, model };
    }
    if (res.status === 404) return { ok: false, code: "bad_request", message: `Modelo ${model} não encontrado: ajuste GEMINI_MODEL.`, model };
    return { ok: false, code: "unavailable", message: `Gemini respondeu ${res.status}.`, model };
  } catch (error) {
    return { ok: false, code: "unavailable", message: redactSecrets(`Falha de rede: ${error instanceof Error ? error.message : String(error)}`), model };
  }
}
