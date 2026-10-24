import { ClaudeProvider } from "../claude";
import { ConnectorError, type ModelProvider } from "../types";
import { GeminiProvider } from "./gemini";
import { isProviderId, type ProviderId } from "./ids";
import { MockProvider, mockScenarioFromEnv } from "./mock";
import { OllamaProvider } from "./ollama";

/**
 * Escolha do provedor, sempre explícita: configuração do projeto (`settings.ai_provider`) ou variável AI_PROVIDER.
 * Sem nenhuma das duas não há provedor — o modo de demonstração nunca é ligado por omissão.
 */
export function resolveProviderId(settings?: Record<string, unknown> | null): ProviderId | null {
  const fromProject = settings?.ai_provider;
  if (isProviderId(fromProject)) return fromProject;
  const fromEnv = process.env.AI_PROVIDER;
  return isProviderId(fromEnv) ? fromEnv : null;
}

export function createProvider(id: ProviderId): ModelProvider {
  switch (id) {
    case "mock":
      return new MockProvider(mockScenarioFromEnv());
    case "gemini":
      return new GeminiProvider();
    case "ollama":
      return new OllamaProvider();
    case "anthropic":
      return new ClaudeProvider();
  }
}

/**
 * Fábrica usada pelo orquestrador (app e worker). Não há fallback: se o provedor escolhido falhar,
 * a tarefa falha com o motivo e o usuário decide se espera ou troca manualmente.
 */
export function createProviderFactory(): (ctx: { project: { settings?: Record<string, unknown> | null } }) => ModelProvider {
  return ({ project }) => {
    const id = resolveProviderId(project.settings);
    if (!id) {
      throw new ConnectorError(
        "pending_credential",
        "Nenhum provedor de IA escolhido: defina AI_PROVIDER ou escolha um provedor em Configurações (use \"mock\" para demonstração).",
        false,
      );
    }
    return createProvider(id);
  };
}
