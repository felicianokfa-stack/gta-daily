import { z } from "zod";
import { ResearchResult, VerificationResult } from "@/core/contracts/research";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock } from "./prompts";

export const VerificationInput = z.object({
  topic: z.string().min(1),
  niche_id: z.string().min(1),
  research: ResearchResult,
  correction_notes: z.array(z.string()).default([]),
});
export type VerificationInput = z.infer<typeof VerificationInput>;

const SYSTEM = `Você é o Verificador de uma equipe de produção de conteúdo.
Sua função: checar contexto, fatos, atualidade, contradições e incertezas das alegações recebidas do Pesquisador.
Regras:
- Classifique cada alegação como fato_confirmado, rumor, teoria, estimativa, hipotese ou nao_verificado.
- Só use fato_confirmado quando houver fonte primária ou várias fontes independentes e confiáveis concordando.
- Nunca transforme rumor em fato nem esconda a ausência de evidência.
- Cite apenas URLs das fontes recebidas ou das que você encontrar na busca. Nunca invente URLs.
- Toda fonte nova que você citar como evidência deve constar em "additional_sources".
- Aponte contradições entre fontes e informações possivelmente desatualizadas.
- Escreva em português do Brasil.`;

export const verificador: AgentDefinition<VerificationInput, VerificationResult> = {
  role: "verificador",
  version: "verificador@1.1.0",
  description: "Classifica alegações (fato, rumor, teoria…) e aponta contradições e ressalvas.",
  inputSchema: VerificationInput,
  resultSchema: VerificationResult,

  buildInput(runInput, previous) {
    return VerificationInput.parse({
      topic: runInput.topic,
      niche_id: runInput.niche_id,
      research: previous.pesquisador,
      correction_notes: [],
    });
  },

  async run(input, ctx) {
    const claims = input.research.claims_to_verify
      .map((c, i) => `${i + 1}. ${c.claim} (classificação preliminar: ${c.initial_label}; fontes: ${c.source_urls.join(", ")})`)
      .join("\n");
    const sources = input.research.sources.map((s) => `- ${s.title} | ${s.url}`).join("\n");
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

<tarefa>
Tema: ${input.topic}
Resumo do Pesquisador: ${input.research.summary}
Fontes recebidas:
${sources || "(nenhuma)"}
Alegações a verificar:
${claims || "(nenhuma)"}
Verifique cada alegação, procurando confirmação independente quando necessário.
</tarefa>${correctionBlock(input.correction_notes)}`;

    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: VerificationResult,
      effort: "medium",
      webSearch: { maxUses: 6 },
      knownSources: input.research.sources.map((s) => ({ url: s.url, title: s.title })),
      role: this.role,
      input,
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(input, result, retrieved) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const retrievedUrls = new Set(retrieved.map((s) => s.url));
    for (const s of result.additional_sources) {
      if (!retrievedUrls.has(s.url)) errors.push(`Fonte adicional não recuperada na busca (possível URL inventada): ${s.url}`);
    }
    // Toda evidência precisa estar registrada como fonte (do Pesquisador ou adicional) para ser rastreável.
    const known = new Set([...input.research.sources.map((s) => s.url), ...result.additional_sources.map((s) => s.url)]);
    const evidence = new Set<string>();

    for (const c of result.claims) {
      for (const url of c.evidence_urls) {
        if (!known.has(url)) errors.push(`Evidência com URL fora das fontes registradas (inclua em additional_sources se veio da busca): ${url}`);
        evidence.add(url);
      }
      if (c.label === "fato_confirmado" && c.evidence_urls.length === 0) {
        errors.push(`"${c.claim}" marcado como fato confirmado sem nenhuma evidência.`);
      }
    }
    const verified = new Set(result.claims.map((c) => c.claim.trim().toLowerCase()));
    const missing = input.research.claims_to_verify.filter((c) => !verified.has(c.claim.trim().toLowerCase()));
    if (missing.length > 0) {
      warnings.push(`${missing.length} alegação(ões) do Pesquisador sem verificação correspondente.`);
    }

    return {
      errors,
      warnings,
      evidence: [...evidence],
      limitations: result.caveats,
      unconfirmed: result.claims.filter((c) => c.label !== "fato_confirmado").map((c) => `${c.claim} (${c.label})`),
    };
  },
};
