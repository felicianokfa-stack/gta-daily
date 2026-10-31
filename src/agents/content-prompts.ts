import type { ClipContext } from "@/core/contracts/content";
import { formatTimestamp } from "@/core/transcript";

/** Bloco comum: o corte escolhido e os trechos da transcrição que o formam (a ÚNICA fonte de conteúdo). */
export function clipBlock(ctx: ClipContext): string {
  const segments = ctx.segments
    .map((s) => `[${s.id}] ${formatTimestamp(s.start_s)}–${formatTimestamp(s.end_s)} (${s.start_s}s–${s.end_s}s): ${s.text}`)
    .join("\n");
  return `<corte>
Material: ${ctx.media_title}${ctx.is_sample ? " (material de exemplo fictício)" : ""}
Título do corte: ${ctx.title}
Justificativa do analista: ${ctx.justification}
Intervalo: ${ctx.start_s}s–${ctx.end_s}s (${(ctx.end_s - ctx.start_s).toFixed(1)}s)
Plataformas do projeto: ${ctx.platforms.join(", ")}
</corte>

<transcricao_do_corte>
${segments}
</transcricao_do_corte>`;
}

export function jsonBlock(tag: string, value: unknown): string {
  return `<${tag}>\n${JSON.stringify(value, null, 2)}\n</${tag}>`;
}

/** Regras comuns a todos os papéis de produção. */
export const PRODUCTION_RULES = `- Use SOMENTE o que está na transcrição do corte. Não invente fatos, falas, números, datas ou fontes.
- A transcrição reflete o que o apresentador diz: ela NÃO confirma fatos. Nunca marque nada como fato confirmado.
- Rumor, teoria e opinião devem ser tratados como tal; vazamento nunca é informação oficial.
- Nunca prometa resultado (viralizar, alcance, sucesso). Não use linguagem de garantia.
- Tempos em segundos, dentro do intervalo do corte.
- Escreva em português do Brasil.`;
