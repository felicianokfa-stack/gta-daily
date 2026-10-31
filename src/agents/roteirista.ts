import { ScriptResult, ScriptwriterInput } from "@/core/contracts/content";
import { LEAK_AS_OFFICIAL_PATTERN, PROMISE_PATTERN, checkTimeline, quoteMatches } from "@/core/content-rules";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock } from "./prompts";
import { PRODUCTION_RULES, clipBlock, jsonBlock } from "./content-prompts";

const SYSTEM = `Você é o Roteirista de uma equipe de produção de vídeos curtos.
Sua função: transformar o corte e o briefing em um roteiro em batidas (locução, texto na tela e tempos).
Regras:
${PRODUCTION_RULES}
- As batidas cobrem o corte em ordem, sem sobreposição; "total_seconds" é a duração do corte.
- "quote" só pode ser uma citação LITERAL do segmento indicado em "segment_id" (copie as palavras exatas); se for parafrasear, use "quote": null.
- Respeite o briefing: rumores e teorias aparecem como tais, com a ressalva dita na locução.`;

export const roteirista: AgentDefinition<ScriptwriterInput, ScriptResult> = {
  role: "roteirista",
  version: "roteirista@1.0.0",
  description: "Escreve o roteiro em batidas (locução, texto na tela, tempos) a partir do corte e do briefing.",
  inputSchema: ScriptwriterInput,
  resultSchema: ScriptResult,

  buildInput(runInput, previous) {
    return ScriptwriterInput.parse({ ...runInput, brief: previous.estrategista, correction_notes: [] });
  },

  async run(input, ctx) {
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

${clipBlock(input)}

${jsonBlock("briefing", input.brief)}

<tarefa>
Escreva o roteiro deste corte.
</tarefa>${correctionBlock(input.correction_notes)}`;
    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: ScriptResult,
      effort: "medium",
      role: this.role,
      input,
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(input, result) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const duration = input.end_s - input.start_s;
    errors.push(...checkTimeline(result.beats, input.start_s, input.end_s, "Batida"));
    if (Math.abs(result.total_seconds - duration) > 2) {
      errors.push(`total_seconds (${result.total_seconds}s) difere da duração do corte (${duration.toFixed(1)}s).`);
    }
    const byId = new Map(input.segments.map((s) => [s.id, s]));
    result.beats.forEach((b, i) => {
      const where = `Batida ${i + 1}`;
      if (b.segment_id !== null && !byId.has(b.segment_id)) errors.push(`${where}: segmento ${b.segment_id} fora do corte.`);
      if (b.quote) {
        const seg = b.segment_id !== null ? byId.get(b.segment_id) : undefined;
        if (!seg) errors.push(`${where}: citação sem um "segment_id" válido.`);
        else if (!quoteMatches(b.quote, seg.text)) errors.push(`${where}: a citação "${b.quote}" não aparece literalmente no segmento ${seg.id}.`);
      }
    });
    const text = result.beats.map((b) => `${b.voiceover} ${b.on_screen_text}`).join(" ");
    if (PROMISE_PATTERN.test(text)) errors.push("O roteiro promete resultado (viralizar, sucesso, alcance).");
    if (LEAK_AS_OFFICIAL_PATTERN.test(text)) errors.push("O roteiro trata vazamento como informação oficial ou confirmada.");
    const last = result.beats[result.beats.length - 1];
    if (last && last.t_end < input.end_s - 3) warnings.push(`O roteiro termina em ${last.t_end}s, antes do fim do corte (${input.end_s}s).`);
    return {
      errors,
      warnings,
      evidence: [],
      limitations: result.disclaimers,
      unconfirmed: input.brief.key_messages.filter((m) => m.label !== "estimativa").map((m) => `${m.text} (${m.label})`),
    };
  },
};
