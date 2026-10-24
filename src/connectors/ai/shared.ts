import { z } from "zod";
import { ConnectorError, type RetrievedSource, type StructuredRequest } from "../types";

/** Variáveis cujo valor nunca pode aparecer em erros, logs ou auditoria. */
const SECRET_ENV = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OLLAMA_API_KEY", "YOUTUBE_API_KEY"];

/** Remove valores de credenciais de um texto antes de ele virar mensagem de erro ou log. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join("[credencial removida]");
  }
  return out.replace(/([?&](?:key|api_key|apikey)=)[^&\s"']+/gi, "$1[credencial removida]");
}

export function intFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Limite do tamanho do que é enviado ao provedor (system + prompt), em caracteres. */
export function maxInputChars(): number {
  return intFromEnv("AI_MAX_INPUT_CHARS", 60_000);
}

export function assertInputSize(request: StructuredRequest<unknown>, provider: string): void {
  const size = request.system.length + request.prompt.length;
  if (size > maxInputChars()) {
    throw new ConnectorError(
      "bad_request",
      `Entrada grande demais para ${provider} (${size} caracteres; limite ${maxInputChars()}, ajustável por AI_MAX_INPUT_CHARS).`,
      false,
      { size },
    );
  }
}

/**
 * Provedores sem busca só "recuperam" as fontes reais já conhecidas.
 * Nunca fabricamos fontes: sem elas a lista fica vazia e a limitação é registrada pelo agente.
 */
export function knownAsRetrieved(request: StructuredRequest<unknown>): RetrievedSource[] {
  return (request.knownSources ?? []).map((s) => ({ url: s.url, title: s.title, page_age: null }));
}

/** Instrução de formato: o contrato Zod do agente em JSON Schema, para provedores sem schema nativo. */
export function schemaInstruction(schema: z.ZodType<unknown>): string {
  return `\n\nResponda SOMENTE com um objeto JSON válido (sem texto antes ou depois, sem markdown) que obedeça a este JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;
}

/** Texto de busca ausente: reforça a regra de não inventar fontes. */
export function noSearchInstruction(request: StructuredRequest<unknown>): string {
  if (!request.webSearch) return "";
  const known = request.knownSources ?? [];
  const list = known.length ? known.map((s) => `- ${s.title} | ${s.url}`).join("\n") : "(nenhuma)";
  return `\n\nNão há ferramenta de pesquisa na web neste provedor. Use SOMENTE as fontes abaixo; não invente URLs, datas ou citações. Se não houver fonte, deixe a lista de fontes vazia e registre a limitação em "unknowns" (Pesquisador) ou "caveats" (Verificador).\n<fontes_conhecidas>\n${list}\n</fontes_conhecidas>`;
}

/** Extrai o JSON da resposta; texto que não é JSON vira null e cai no ciclo de correção do orquestrador. */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
