import { StrategistInput, StrategyBrief } from "@/core/contracts/content";
import { LEAK_AS_OFFICIAL_PATTERN, PROMISE_PATTERN } from "@/core/content-rules";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock } from "./prompts";
import { PRODUCTION_RULES, clipBlock } from "./content-prompts";

const SYSTEM = `Você é o Estrategista de uma equipe de produção de vídeos curtos.
Sua função: definir o briefing editorial do corte escolhido (ângulo, gancho, público, mensagens-chave, chamada para ação e prioridade de plataformas).
Regras:
${PRODUCTION_RULES}
- Cada mensagem-chave cita os ids dos segmentos da transcrição que a sustentam e recebe um rótulo: rumor, teoria, estimativa, hipotese ou nao_verificado (nunca fato_confirmado).
- Em "cautions", aponte o que pode induzir a erro (rumores, falta de contexto, trecho incompleto).
- A prioridade de plataformas só pode usar as plataformas do projeto.`;

export const estrategista: AgentDefinition<StrategistInput, StrategyBrief> = {
  role: "estrategista",
  version: "estrategista@1.0.0",
  description: "Define o briefing do corte: ângulo, gancho, mensagens com rótulo de evidência e prioridade de plataformas.",
  inputSchema: StrategistInput,
  resultSchema: StrategyBrief,

  buildInput(runInput) {
    return StrategistInput.parse({ ...runInput, correction_notes: [] });
  },

  async run(input, ctx) {
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

${clipBlock(input)}

<tarefa>
Monte o briefing deste corte.
</tarefa>${correctionBlock(input.correction_notes)}`;
    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: StrategyBrief,
      effort: "medium",
      role: this.role,
      input,
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(input, result) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ids = new Set(input.segments.map((s) => s.id));
    result.key_messages.forEach((m, i) => {
      const missing = m.segment_ids.filter((id) => !ids.has(id));
      if (missing.length > 0) errors.push(`Mensagem ${i + 1}: segmentos fora do corte: ${missing.join(", ")}.`);
    });
    const outside = result.platform_priority.filter((p) => !input.platforms.includes(p));
    if (outside.length > 0) errors.push(`Prioridade com plataforma que o projeto não usa: ${outside.join(", ")}.`);
    const text = [result.angle, result.hook, result.cta, ...result.key_messages.map((m) => m.text)].join(" ");
    if (PROMISE_PATTERN.test(text)) errors.push("O briefing promete resultado (viralizar, sucesso, alcance): descreva só o conteúdo.");
    if (LEAK_AS_OFFICIAL_PATTERN.test(text)) errors.push("O briefing trata vazamento como informação oficial ou confirmada.");
    if (input.is_sample) warnings.push("Material de exemplo fictício: use apenas para testar o fluxo.");
    return {
      errors,
      warnings,
      evidence: [],
      limitations: result.cautions,
      unconfirmed: result.key_messages.map((m) => `${m.text} (${m.label})`),
    };
  },
};
