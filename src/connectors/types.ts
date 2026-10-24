import type { z } from "zod";

/** Estado de um conector, mostrado na interface. Nunca simulamos um conector como "conectado". */
export type ConnectorState =
  | "connected" // credencial presente e uso validado
  | "credential_present" // credencial presente, ainda não validada nesta execução
  | "pending_credential" // falta credencial
  | "demo" // modo de demonstração: resultados fictícios, sem credencial nem custo
  | "needs_validation" // falta validar documentação oficial / plano / limites
  | "not_supported";

export interface ConnectorInfo {
  id: string;
  name: string;
  purpose: string;
  state: ConnectorState;
  notes: string;
}

export type ConnectorErrorCode =
  | "pending_credential"
  | "authentication"
  | "rate_limited"
  /** Limite do plano gratuito esgotado: esperar a renovação ou trocar de provedor manualmente. Não é retentável. */
  | "quota_exhausted"
  | "unavailable"
  | "bad_request"
  | "refusal"
  | "truncated";

/** Erro de conector com classificação explícita de retentativa para o orquestrador. */
export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export interface ModelUsage {
  /** Provedor que atendeu a chamada (mock, gemini, ollama, anthropic). */
  provider?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens?: number;
  web_search_requests: number;
}

export interface RetrievedSource {
  url: string;
  title: string;
  page_age: string | null;
}

export interface StructuredRequest<T> {
  /** Instruções estáveis do papel (cacheáveis). */
  system: string;
  /** Conteúdo variável da tarefa. */
  prompt: string;
  schema: z.ZodType<T>;
  effort: "low" | "medium" | "high";
  /** Quando presente, o provedor pesquisa na web e devolve as fontes efetivamente recuperadas. */
  webSearch?: { maxUses: number };
  /**
   * Fontes reais já conhecidas (registradas no projeto ou informadas pelo usuário). Provedores sem busca
   * devolvem só estas como "recuperadas"; nunca inventam fontes.
   */
  knownSources?: { url: string; title: string }[];
  /** Papel do agente e entrada estruturada: usados apenas pelo provedor de demonstração. */
  role?: string;
  input?: unknown;
}

export interface ProviderCapabilities {
  /** Pesquisa na web nativa do provedor. Sem ela, só entram fontes de `knownSources`. */
  webSearch: boolean;
  /** Resultados fictícios: nunca podem ser tratados como achados reais. */
  simulated: boolean;
}

export interface StructuredResponse {
  /** Saída bruta do modelo. Quem valida contra o contrato é o orquestrador. */
  data: unknown;
  retrievedSources: RetrievedSource[];
  usage: ModelUsage[];
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities?: ProviderCapabilities;
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse>;
}
