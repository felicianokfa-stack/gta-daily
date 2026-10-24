import { z } from "zod";
import { ConnectorError, type ModelProvider, type StructuredRequest, type StructuredResponse } from "../types";
import { assertInputSize, intFromEnv, knownAsRetrieved, noSearchInstruction, parseJsonLoose, redactSecrets } from "./shared";

/**
 * Provedor opcional para modelos locais via Ollama (`/api/chat`). Sem busca na web: só usa as fontes conhecidas.
 * O modelo é escolhido por OLLAMA_MODEL; o endereço por OLLAMA_BASE_URL (padrão http://localhost:11434).
 * Em hospedagem serverless (Vercel) o Ollama local não é alcançável: use no worker local (`npm run worker`).
 */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/$/, "");
}
export function ollamaModel(): string | undefined {
  return process.env.OLLAMA_MODEL || undefined;
}
export function hasOllamaConfig(): boolean {
  return Boolean(ollamaModel());
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Verifica se o servidor Ollama responde e se o modelo configurado está instalado. */
export async function testOllamaConnection(
  opts: { fetch?: FetchLike } = {},
): Promise<{ ok: boolean; message: string; model: string | null }> {
  const model = ollamaModel() ?? null;
  if (!model) return { ok: false, message: "OLLAMA_MODEL não configurado.", model };
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  try {
    const res = await doFetch(`${ollamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, message: `Ollama respondeu ${res.status}.`, model };
    const body = (await res.json().catch(() => ({}))) as { models?: { name?: string }[] };
    const installed = (body.models ?? []).some((m) => m.name === model || m.name?.startsWith(`${model}:`));
    return installed
      ? { ok: true, message: `Ollama acessível e modelo ${model} instalado.`, model }
      : { ok: false, message: `Ollama acessível, mas o modelo ${model} não está instalado (ollama pull ${model}).`, model };
  } catch (error) {
    return { ok: false, message: `Ollama inacessível em ${ollamaBaseUrl()}: ${redactSecrets(error instanceof Error ? error.message : String(error))}`, model };
  }
}

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly capabilities = { webSearch: false, simulated: false } as const;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(opts: { model?: string; baseUrl?: string; fetch?: FetchLike } = {}) {
    const model = opts.model ?? ollamaModel();
    if (!model) {
      throw new ConnectorError("pending_credential", "Ollama sem modelo: configure OLLAMA_MODEL (e OLLAMA_BASE_URL se não for o padrão).", false);
    }
    this.model = model;
    this.baseUrl = (opts.baseUrl ?? ollamaBaseUrl()).replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse> {
    assertInputSize(request, "o Ollama");
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: z.toJSONSchema(request.schema),
          options: { temperature: 0.2 },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt + noSearchInstruction(request) },
          ],
        }),
        signal: AbortSignal.timeout(intFromEnv("OLLAMA_TIMEOUT_MS", 300_000)),
      });
    } catch (error) {
      throw new ConnectorError("unavailable", `Ollama inacessível em ${this.baseUrl}: ${redactSecrets(error instanceof Error ? error.message : String(error))}`, true);
    }
    if (!res.ok) {
      const code = res.status === 404 ? "bad_request" : res.status >= 500 ? "unavailable" : "bad_request";
      throw new ConnectorError(code, `Ollama respondeu ${res.status} (modelo "${this.model}" instalado?).`, code === "unavailable");
    }
    const body = (await res.json().catch(() => ({}))) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      data: parseJsonLoose(body.message?.content ?? ""),
      retrievedSources: knownAsRetrieved(request),
      usage: [
        {
          provider: "ollama",
          model: this.model,
          input_tokens: body.prompt_eval_count ?? 0,
          output_tokens: body.eval_count ?? 0,
          cache_read_input_tokens: 0,
          web_search_requests: 0,
        },
      ],
    };
  }
}
