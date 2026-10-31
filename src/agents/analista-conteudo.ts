import {
  CLIP_MAX_SECONDS,
  CLIP_MIN_SECONDS,
  ContentAnalysisInput,
  ContentAnalysisResult,
} from "@/core/contracts/content";
import { formatTimestamp } from "@/core/transcript";
import type { AgentDefinition } from "./types";
import { contextBlock, correctionBlock } from "./prompts";

const SYSTEM = `Você é o Analista de Conteúdo de uma equipe de produção de vídeos curtos.
Sua função: ler a transcrição de um material (com marcações de tempo) e sugerir os melhores trechos para cortes curtos.
Regras:
- Use SOMENTE o que está na transcrição. Não invente fatos, falas, tempos ou contexto que não estejam nela.
- Cada corte precisa citar os ids dos segmentos que o formam; o início e o fim devem coincidir com o primeiro e o último segmento citado.
- Cada corte deve durar entre ${CLIP_MIN_SECONDS} e ${CLIP_MAX_SECONDS} segundos e fazer sentido sozinho.
- A pontuação (0 a 100) é o INTERESSE EDITORIAL estimado (gancho, clareza, completude). Não é probabilidade de viralizar nem de sucesso: nunca prometa resultado.
- Aponte riscos: rumor ou teoria apresentados como fato, trecho sem contexto, material que pareça de terceiros sem autorização.
- Se o material não tiver bons cortes, devolva menos candidatos e explique em "unknowns".
- Escreva em português do Brasil.`;

function formatTranscript(input: ContentAnalysisInput): string {
  return input.transcript
    .map((s) => `[${s.id}] ${formatTimestamp(s.start_s)}–${formatTimestamp(s.end_s)} (${s.start_s}s–${s.end_s}s): ${s.text}`)
    .join("\n");
}

/** Linguagem de promessa de resultado, proibida nas justificativas e nas pontuações. */
const PROMISE_PATTERN = /probabilidade de (viraliz|sucesso)|vai viralizar|(garant\w+|certeza de) (viral|sucesso|alcance)/i;

export const analistaConteudo: AgentDefinition<ContentAnalysisInput, ContentAnalysisResult> = {
  role: "analista_conteudo",
  version: "analista_conteudo@1.0.0",
  description: "Lê a transcrição de um material e sugere cortes com início, fim, justificativa e pontuação editorial.",
  inputSchema: ContentAnalysisInput,
  resultSchema: ContentAnalysisResult,

  buildInput(runInput) {
    return ContentAnalysisInput.parse({
      media_id: runInput.media_id,
      title: runInput.title,
      kind: runInput.kind,
      is_sample: runInput.is_sample ?? false,
      duration_seconds: runInput.duration_seconds,
      metadata: runInput.metadata ?? {},
      transcript: runInput.transcript,
      niche_id: runInput.niche_id,
      goal: runInput.goal ?? "",
      correction_notes: [],
    });
  },

  async run(input, ctx) {
    const prompt = `${contextBlock(ctx.niche, ctx.project)}

<material>
Título: ${input.title}
Duração: ${formatTimestamp(input.duration_seconds)} (${input.duration_seconds}s)
Tipo: ${input.kind}${input.is_sample ? " (material de exemplo fictício)" : ""}
Objetivo editorial: ${input.goal || "não informado"}
</material>

<transcricao>
${formatTranscript(input)}
</transcricao>

<tarefa>
Sugira até 5 cortes. Para cada um: título, justificativa, início e fim em segundos, ids dos segmentos, pontuação editorial com o motivo e os riscos.
</tarefa>${correctionBlock(input.correction_notes)}`;

    const response = await ctx.provider.generateStructured({
      system: SYSTEM,
      prompt,
      schema: ContentAnalysisResult,
      effort: "medium",
      role: this.role,
      input,
    });
    return { raw: response.data, retrievedSources: response.retrievedSources, usage: response.usage };
  },

  validate(input, result) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const byId = new Map(input.transcript.map((s) => [s.id, s]));
    const first = input.transcript[0].start_s;
    const last = input.transcript[input.transcript.length - 1].end_s;
    const TOLERANCE_S = 1;

    result.candidates.forEach((c, i) => {
      const label = `Corte ${i + 1} ("${c.title}")`;
      const duration = c.end_s - c.start_s;
      if (c.end_s <= c.start_s) errors.push(`${label}: o fim (${c.end_s}s) precisa ser maior que o início (${c.start_s}s).`);
      if (c.start_s < first - TOLERANCE_S || c.end_s > last + TOLERANCE_S || c.end_s > input.duration_seconds + TOLERANCE_S) {
        errors.push(`${label}: tempos fora da transcrição (${first}s–${last}s, duração ${input.duration_seconds}s).`);
      }
      if (duration < CLIP_MIN_SECONDS || duration > CLIP_MAX_SECONDS) {
        errors.push(`${label}: duração de ${duration.toFixed(1)}s fora do intervalo ${CLIP_MIN_SECONDS}–${CLIP_MAX_SECONDS}s.`);
      }
      const missing = c.segment_ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        errors.push(`${label}: segmentos inexistentes na transcrição: ${missing.join(", ")}.`);
      } else {
        const cited = c.segment_ids.map((id) => byId.get(id)!);
        const from = Math.min(...cited.map((s) => s.start_s));
        const to = Math.max(...cited.map((s) => s.end_s));
        if (Math.abs(c.start_s - from) > TOLERANCE_S || Math.abs(c.end_s - to) > TOLERANCE_S) {
          errors.push(
            `${label}: início/fim (${c.start_s}s–${c.end_s}s) não coincidem com os segmentos citados (${from}s–${to}s).`,
          );
        }
      }
      if (PROMISE_PATTERN.test(`${c.justification} ${c.score.reason}`)) {
        errors.push(`${label}: a justificativa ou a pontuação promete resultado; descreva só o interesse editorial.`);
      }
    });

    const titles = result.candidates.map((c) => c.title.trim().toLowerCase());
    if (new Set(titles).size !== titles.length) warnings.push("Há candidatos com o mesmo título.");
    if (result.candidates.length === 0 && result.unknowns.length === 0) {
      errors.push('Nenhum corte sugerido e nenhum motivo em "unknowns": explique o que impediu a sugestão.');
    }
    if (result.candidates.length === 0) warnings.push("Nenhum corte sugerido para este material.");
    if (input.is_sample) warnings.push("Material de exemplo fictício: use apenas para testar o fluxo.");

    return {
      errors,
      warnings,
      evidence: [],
      limitations: result.unknowns,
      unconfirmed: result.candidates.flatMap((c) => c.risks),
    };
  },
};
