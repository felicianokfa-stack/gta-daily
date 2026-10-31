import { ProducerInput, ProductionPlan } from "@/core/contracts/content";
import { NEW_AUDIO_PATTERN, checkTimeline } from "@/core/content-rules";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock } from "./prompts";
import { PRODUCTION_RULES, clipBlock, jsonBlock } from "./content-prompts";

const SUBTITLE_LINE_MAX = 42;
const SUBTITLE_MIN_SECONDS = 0.8;
const SUBTITLE_MAX_CPS = 21;

const SYSTEM = `Você é o Produtor Audiovisual de uma equipe de produção de vídeos curtos.
Sua função: montar o PLANO DE EDIÇÃO do corte (formato 9:16, cortes/planos, legendas sincronizadas, notas de áudio e ativos necessários).
Você NÃO renderiza nada: o resultado é só um plano e "rendered" é sempre false.
Regras:
${PRODUCTION_RULES}
- Cortes e legendas ficam em ordem, sem sobreposição, dentro do intervalo do corte.
- Cada legenda tem no máximo 2 linhas de ${SUBTITLE_LINE_MAX} caracteres e dura pelo menos ${SUBTITLE_MIN_SECONDS}s.
- Não invente imagens, gravações ou ativos que não existam: liste em "assets_needed" o que precisaria ser providenciado.
- "audio_notes" só descreve o áudio que o corte já tem (ex.: manter o áudio original). Não proponha trilha, música nem efeitos novos: o app não fornece esses ativos.`;

export const produtorAudiovisual: AgentDefinition<ProducerInput, ProductionPlan> = {
  role: "produtor_audiovisual",
  version: "produtor_audiovisual@1.0.0",
  description: "Monta o plano de edição 9:16 (cortes, legendas sincronizadas, áudio, ativos). Não renderiza arquivos.",
  inputSchema: ProducerInput,
  resultSchema: ProductionPlan,

  buildInput(runInput, previous) {
    return ProducerInput.parse({ ...runInput, brief: previous.estrategista, script: previous.roteirista, correction_notes: [] });
  },

  async run(input, ctx) {
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

${clipBlock(input)}

${jsonBlock("briefing", input.brief)}

${jsonBlock("roteiro", input.script)}

<tarefa>
Monte o plano de edição (sem renderizar).
</tarefa>${correctionBlock(input.correction_notes)}`;
    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: ProductionPlan,
      effort: "medium",
      role: this.role,
      input,
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(input, result) {
    const errors: string[] = [];
    const warnings: string[] = [];
    errors.push(...checkTimeline(result.cuts, input.start_s, input.end_s, "Corte de edição"));
    errors.push(...checkTimeline(result.subtitles, input.start_s, input.end_s, "Legenda"));
    result.subtitles.forEach((s, i) => {
      const lines = s.text.split("\n");
      const where = `Legenda ${i + 1}`;
      if (lines.length > 2) errors.push(`${where}: mais de 2 linhas.`);
      if (lines.some((l) => l.length > SUBTITLE_LINE_MAX)) errors.push(`${where}: linha com mais de ${SUBTITLE_LINE_MAX} caracteres.`);
      const dur = s.t_end - s.t_start;
      if (dur < SUBTITLE_MIN_SECONDS) errors.push(`${where}: dura só ${dur.toFixed(2)}s (mínimo ${SUBTITLE_MIN_SECONDS}s).`);
      else if (s.text.replace(/\s/g, "").length / dur > SUBTITLE_MAX_CPS) warnings.push(`${where}: leitura rápida demais (mais de ${SUBTITLE_MAX_CPS} caracteres por segundo).`);
    });
    if (result.audio_notes.some((n) => NEW_AUDIO_PATTERN.test(n))) {
      warnings.push("As notas de áudio sugerem trilha, música ou efeitos novos, que o app não fornece: confirme se faz sentido.");
    }
    warnings.push("Plano de edição: nenhum arquivo de vídeo foi gerado.");
    return { errors, warnings, evidence: [], limitations: result.assets_needed, unconfirmed: [] };
  },
};
