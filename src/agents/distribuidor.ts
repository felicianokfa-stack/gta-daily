import { Distribution, DistributorInput } from "@/core/contracts/content";
import { PLATFORM_LIMITS, distributionProblems } from "@/core/content-rules";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock } from "./prompts";
import { PRODUCTION_RULES, clipBlock, jsonBlock } from "./content-prompts";

const SYSTEM = `Você é o Distribuidor de uma equipe de produção de vídeos curtos.
Sua função: preparar os metadados de cada plataforma do projeto (título, legenda, hashtags, texto de capa e observação de horário).
Você NÃO publica nada: só prepara textos para revisão humana.
Regras:
${PRODUCTION_RULES}
- Uma versão por plataforma do projeto, nem mais nem menos.
- Hashtags no formato #palavra (sem espaços), sem repetir.
- Respeite os limites de caracteres e de hashtags de cada plataforma; deixe margem.
- Mantenha o tom do briefing e as ressalvas sobre rumores e teorias.`;

export const distribuidor: AgentDefinition<DistributorInput, Distribution> = {
  role: "distribuidor",
  version: "distribuidor@1.0.0",
  description: "Prepara título, legenda, hashtags e capa por plataforma. Não publica.",
  inputSchema: DistributorInput,
  resultSchema: Distribution,

  buildInput(runInput, previous) {
    return DistributorInput.parse({ ...runInput, brief: previous.estrategista, script: previous.roteirista, correction_notes: [] });
  },

  async run(input, ctx) {
    const limits = input.platforms.map((p) => `${p}: título até ${PLATFORM_LIMITS[p].title}, legenda até ${PLATFORM_LIMITS[p].caption}, até ${PLATFORM_LIMITS[p].hashtags} hashtags`).join("\n");
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

${clipBlock(input)}

${jsonBlock("briefing", input.brief)}

${jsonBlock("roteiro", input.script)}

<limites_do_app>
${limits}
</limites_do_app>

<tarefa>
Prepare uma versão por plataforma.
</tarefa>${correctionBlock(input.correction_notes)}`;
    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: Distribution,
      effort: "low",
      role: this.role,
      input,
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(input, result) {
    const errors: string[] = [];
    const warnings: string[] = [];
    errors.push(...distributionProblems(input.platforms, result.versions));
    warnings.push("Os limites por plataforma são os do app: confira nas plataformas antes de publicar. Nada foi publicado.");
    return { errors, warnings, evidence: [], limitations: [], unconfirmed: [] };
  },
};
