import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  ConnectorError,
  type ModelProvider,
  type ModelUsage,
  type RetrievedSource,
  type StructuredRequest,
  type StructuredResponse,
} from "./types";

/** Modelo padrão: Claude Sonnet 5.5 (escolhido pelo custo). Pode ser trocado por CLAUDE_MODEL. */
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
}
// Em recusa por política (categorias cobertas pelo modelo), a API refaz a requisição no modelo de fallback padrão (opt-in).
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_PAUSE_CONTINUATIONS = 4;

export function hasClaudeCredential(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Adaptador do Claude. Duas etapas quando há pesquisa:
 * 1. o modelo pesquisa com a ferramenta de busca do servidor e anota o que encontrou;
 * 2. o modelo estrutura a resposta (structured outputs) usando só as fontes recuperadas.
 * As URLs recuperadas vêm dos blocos `web_search_tool_result`, não do texto do modelo,
 * para que o orquestrador possa rejeitar qualquer fonte inventada.
 */
export class ClaudeProvider implements ModelProvider {
  readonly id = "claude";
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    if (!client && !hasClaudeCredential()) {
      throw new ConnectorError(
        "pending_credential",
        "Claude sem credencial: configure ANTHROPIC_API_KEY no servidor/worker.",
        false,
      );
    }
    this.client = client ?? new Anthropic();
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse> {
    const usage: ModelUsage[] = [];
    let retrieved: RetrievedSource[] = [];
    let notes = "";

    if (request.webSearch) {
      const research = await this.research(request, usage);
      retrieved = research.sources;
      notes = research.notes;
    }

    const sourcesBlock = request.webSearch
      ? `\n\n<fontes_recuperadas>\n${
          retrieved.length
            ? retrieved.map((s) => `- ${s.title} | ${s.url}${s.page_age ? ` | ${s.page_age}` : ""}`).join("\n")
            : "(nenhuma fonte recuperada)"
        }\n</fontes_recuperadas>\n\n<anotacoes_da_pesquisa>\n${notes || "(sem anotações)"}\n</anotacoes_da_pesquisa>\n\nUse somente URLs listadas em <fontes_recuperadas>. Se algo não tiver fonte, registre como desconhecido.`
      : "";

    const response = await this.call(() =>
      this.client.beta.messages.parse({
        model: claudeModel(),
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: request.prompt + sourcesBlock }],
      }),
    );
    usage.push(toUsage(response.model, response.usage));
    this.assertCompleted(response.stop_reason, response.stop_details);

    return { data: response.parsed_output ?? null, retrievedSources: retrieved, usage };
  }

  private async research(
    request: StructuredRequest<unknown>,
    usage: ModelUsage[],
  ): Promise<{ sources: RetrievedSource[]; notes: string }> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: `${request.prompt}\n\nPesquise na web e anote, em tópicos, o que cada fonte afirma (com a URL). Não estruture em JSON.`,
      },
    ];
    const sources = new Map<string, RetrievedSource>();
    let notes = "";

    for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
      const response = await this.call(() =>
        this.client.beta.messages.create({
          model: claudeModel(),
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: request.effort },
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: request.webSearch?.maxUses ?? 5 }],
          messages,
        }),
      );
      usage.push(toUsage(response.model, response.usage));
      this.assertCompleted(response.stop_reason, response.stop_details);

      for (const block of response.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) {
            sources.set(r.url, { url: r.url, title: r.title, page_age: r.page_age ?? null });
          }
        } else if (block.type === "text") {
          notes += block.text;
        }
      }
      // A busca no servidor pode pausar o turno; continuamos com o conteúdo completo.
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }
    return { sources: [...sources.values()], notes };
  }

  private assertCompleted(stopReason: string | null, stopDetails: unknown): void {
    if (stopReason === "refusal") {
      throw new ConnectorError("refusal", "O modelo recusou a tarefa por política de segurança.", false, {
        stop_details: stopDetails ?? null,
      });
    }
    if (stopReason === "max_tokens") {
      throw new ConnectorError("truncated", "Resposta cortada pelo limite de tokens.", true);
    }
  }

  private async call<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ConnectorError("authentication", `Credencial do Claude recusada (${error.status}).`, false);
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ConnectorError("rate_limited", "Limite de requisições do Claude atingido.", true);
      }
      if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
        throw new ConnectorError("bad_request", `Requisição inválida ao Claude: ${error.message}`, false);
      }
      if (error instanceof Anthropic.APIError) {
        // 408/409/5xx e falhas de conexão (o SDK já retentou 2 vezes).
        throw new ConnectorError("unavailable", `Claude indisponível: ${error.message}`, true);
      }
      throw error;
    }
  }
}

function toUsage(model: string, u: Anthropic.Beta.BetaUsage): ModelUsage {
  return {
    model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    web_search_requests: u.server_tool_use?.web_search_requests ?? 0,
  };
}
