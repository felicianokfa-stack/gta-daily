/** Identificadores dos provedores de IA. Sem dependências de servidor: pode ser usado por telas e rótulos. */
export const PROVIDER_IDS = ["mock", "gemini", "ollama", "anthropic"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  mock: "Demonstração (simulado)",
  gemini: "Google Gemini",
  ollama: "Ollama (modelo local)",
  anthropic: "Claude (Anthropic)",
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Resultados desses provedores são fictícios e nunca podem virar fonte ou fato real. */
export const SIMULATED_PROVIDERS: readonly string[] = ["mock"];

export function isSimulatedProvider(id: string | null | undefined): boolean {
  return Boolean(id) && SIMULATED_PROVIDERS.includes(id as string);
}
