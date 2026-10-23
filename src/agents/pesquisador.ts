import { ResearchInput, ResearchResult } from "@/core/contracts/research";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock, knownSourcesBlock } from "./prompts";

const SYSTEM = `Você é o Pesquisador de uma equipe de produção de conteúdo.
Sua função: reunir fontes, datas, metadados e evidências sobre um tema e listar as alegações que precisam ser verificadas.
Regras:
- Use apenas fontes que você realmente encontrou na busca. Nunca invente URLs, datas, números ou citações.
- Não trate toda fonte como confiável: prefira fontes primárias e diga quando uma informação vem só de fontes secundárias.
- Rumores, vazamentos e teorias devem ser classificados como tal.
- Se algo não foi encontrado, registre em "unknowns" em vez de preencher.
- Em "relevance", estime de 0 a 100 o interesse editorial do tema para o público agora (novidade, atualidade, impacto) e justifique. Não é probabilidade de viralizar.
- Escreva em português do Brasil.`;

export const pesquisador: AgentDefinition<ResearchInput, ResearchResult> = {
  role: "pesquisador",
  version: "pesquisador@1.1.0",
  description: "Reúne fontes, metadados e alegações a verificar sobre um tema.",
  inputSchema: ResearchInput,
  resultSchema: ResearchResult,

  buildInput(runInput) {
    return ResearchInput.parse({
      topic: runInput.topic,
      goal: runInput.goal ?? "",
      niche_id: runInput.niche_id,
      known_sources: runInput.known_sources ?? [],
      correction_notes: [],
    });
  },

  async run(input, ctx) {
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

<tarefa>
Tema: ${input.topic}
Objetivo editorial: ${input.goal || "não informado"}
Reúna as fontes mais relevantes e atuais, resuma o que se sabe e liste as alegações que o Verificador deve checar.
</tarefa>${knownSourcesBlock(input.known_sources)}${correctionBlock(input.correction_notes)}`;

    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: ResearchResult,
      effort: "low",
      webSearch: { maxUses: 6 },
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(_input, result, retrieved) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const retrievedUrls = new Set(retrieved.map((s) => s.url));
    const sourceUrls = new Set(result.sources.map((s) => s.url));

    for (const s of result.sources) {
      if (!retrievedUrls.has(s.url)) errors.push(`Fonte não recuperada na busca (possível URL inventada): ${s.url}`);
    }
    for (const c of result.claims_to_verify) {
      for (const url of c.source_urls) {
        if (!sourceUrls.has(url)) errors.push(`Alegação cita URL fora da lista de fontes: "${c.claim}" → ${url}`);
      }
    }
    if (result.sources.length === 0 && result.unknowns.length === 0) {
      errors.push('Nenhuma fonte e nenhum desconhecido registrado: explique em "unknowns" o que faltou.');
    }
    if (result.sources.length === 0) warnings.push("Pesquisa sem fontes: o tema não pode avançar como fato.");
    if (result.claims_to_verify.length === 0) warnings.push("Nenhuma alegação a verificar.");

    return {
      errors,
      warnings,
      evidence: [...sourceUrls],
      limitations: result.unknowns,
      unconfirmed: result.claims_to_verify.map((c) => c.claim),
    };
  },
};
