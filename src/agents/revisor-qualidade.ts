import { ReviewResult, ReviewerInput } from "@/core/contracts/content";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock } from "./prompts";
import { PRODUCTION_RULES, clipBlock, jsonBlock } from "./content-prompts";

const SYSTEM = `Você é o Revisor de Qualidade de uma equipe de produção de vídeos curtos.
Sua função: revisar o pacote do corte (briefing, roteiro, plano de edição e versões por plataforma) antes da revisão HUMANA.
Regras:
${PRODUCTION_RULES}
- Confira: fidelidade à transcrição, rótulos de evidência, tempos coerentes, citações literais, legendas legíveis, plataformas completas e ausência de promessas.
- Veredito: "aprovado_para_revisao" só se TODAS as checagens passarem; "ajustes" para problemas corrigíveis; "reprovado" para problemas graves.
- Para qualquer veredito diferente de aprovado, liste os problemas em "issues" e as correções em "suggested_fixes".
- Você não aprova nada de forma definitiva: a decisão final é de uma pessoa.`;

export const revisorQualidade: AgentDefinition<ReviewerInput, ReviewResult> = {
  role: "revisor_qualidade",
  version: "revisor_qualidade@1.0.0",
  description: "Revisa o pacote do corte e dá um veredito para a revisão humana (o portão determinístico confere de novo).",
  inputSchema: ReviewerInput,
  resultSchema: ReviewResult,

  buildInput(runInput, previous) {
    return ReviewerInput.parse({
      ...runInput,
      brief: previous.estrategista,
      script: previous.roteirista,
      plan: previous.produtor_audiovisual,
      distribution: previous.distribuidor,
      correction_notes: [],
    });
  },

  async run(input, ctx) {
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

${clipBlock(input)}

${jsonBlock("briefing", input.brief)}

${jsonBlock("roteiro", input.script)}

${jsonBlock("plano_de_edicao", input.plan)}

${jsonBlock("versoes_por_plataforma", input.distribution)}

<tarefa>
Revise o pacote e dê o veredito.
</tarefa>${correctionBlock(input.correction_notes)}`;
    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: ReviewResult,
      effort: "medium",
      role: this.role,
      input,
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(input, result) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const failed = result.checks.filter((c) => !c.passed);
    if (result.verdict === "aprovado_para_revisao" && failed.length > 0) {
      errors.push(`Veredito "aprovado_para_revisao" com checagens reprovadas: ${failed.map((c) => c.rule).join(", ")}.`);
    }
    if (result.verdict !== "aprovado_para_revisao" && result.issues.length === 0) {
      errors.push("Veredito diferente de aprovado precisa listar os problemas em issues.");
    }
    if (input.is_sample) warnings.push("Material de exemplo fictício: use apenas para testar o fluxo.");
    return { errors, warnings, evidence: [], limitations: result.issues, unconfirmed: [] };
  },
};
