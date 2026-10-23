import type { ModelUsage } from "./types";

/**
 * Preços de tabela da Claude API, em US$ por milhão de tokens (fonte: documentação da Anthropic, out/2026).
 * O custo calculado é uma estimativa a preço de lista: descontos contratados não entram, e em caso de
 * fallback no servidor só a tentativa que gerou a resposta é contada.
 */
const PRICES: { prefix: string; input: number; output: number; cacheRead: number }[] = [
  { prefix: "claude-sonnet-5-5", input: 2, output: 10, cacheRead: 0.2 },
  { prefix: "claude-sonnet-5", input: 2, output: 10, cacheRead: 0.2 },
  { prefix: "claude-opus-5-5", input: 4, output: 20, cacheRead: 0.2 },
  { prefix: "claude-opus-5", input: 5, output: 25, cacheRead: 0.5 },
];
/** Escrita no cache de 5 minutos custa 1,25× a entrada. */
const CACHE_WRITE_MULTIPLIER = 1.25;
/** Busca na web: US$ 10 por 1.000 buscas. */
const WEB_SEARCH_USD = 0.01;

export interface CostEstimate {
  usd: number;
  /** Modelos sem preço conhecido (o custo deles não entrou na soma). */
  unpriced: string[];
}

export function estimateCost(usage: ModelUsage[]): CostEstimate {
  let usd = 0;
  const unpriced = new Set<string>();
  for (const u of usage) {
    usd += u.web_search_requests * WEB_SEARCH_USD;
    const price = PRICES.find((p) => u.model === p.prefix || u.model.startsWith(`${p.prefix}-`));
    if (!price) {
      unpriced.add(u.model);
      continue;
    }
    usd +=
      (u.input_tokens * price.input +
        (u.cache_creation_input_tokens ?? 0) * price.input * CACHE_WRITE_MULTIPLIER +
        u.cache_read_input_tokens * price.cacheRead +
        u.output_tokens * price.output) /
      1_000_000;
  }
  return { usd: Math.round(usd * 10_000) / 10_000, unpriced: [...unpriced] };
}

export function formatUsd(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;
}
