import type { ClipContext, Distribution, ProductionPlan, ReviewResult, ScriptResult, StrategyBrief } from "@/core/contracts/content";
import { checkTimeline, distributionProblems, quoteMatches, textProblems } from "@/core/content-rules";

export interface DraftGateCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface DraftGateResult {
  passed: boolean;
  checks: DraftGateCheck[];
  /** Motivos de reprovação, em linguagem para o usuário. */
  reasons: string[];
}

function check(rule: string, problems: string[], okDetail: string): DraftGateCheck {
  return { rule, passed: problems.length === 0, detail: problems.length === 0 ? okDetail : problems.slice(0, 3).join(" ") + (problems.length > 3 ? ` (+${problems.length - 3})` : "") };
}

/**
 * Portão determinístico do rascunho (no padrão de quality-gate.ts): reconfere, sem IA, o que cada agente já validou
 * e junta o veredito do Revisor. Ele não aprova nada: só informa se o pacote está pronto para a revisão humana.
 */
export function evaluateDraftGate(
  ctx: ClipContext,
  brief: StrategyBrief,
  script: ScriptResult,
  plan: ProductionPlan,
  distribution: Distribution,
  review: ReviewResult,
): DraftGateResult {
  const timeline = [
    ...checkTimeline(script.beats, ctx.start_s, ctx.end_s, "Batida"),
    ...checkTimeline(plan.cuts, ctx.start_s, ctx.end_s, "Corte de edição"),
    ...checkTimeline(plan.subtitles, ctx.start_s, ctx.end_s, "Legenda"),
  ];

  const byId = new Map(ctx.segments.map((s) => [s.id, s]));
  const quoteProblems: string[] = [];
  script.beats.forEach((b, i) => {
    if (!b.quote) return;
    const seg = b.segment_id !== null ? byId.get(b.segment_id) : undefined;
    if (!seg || !quoteMatches(b.quote, seg.text)) quoteProblems.push(`Batida ${i + 1}: citação que não bate com a transcrição.`);
  });

  const labelProblems: string[] = [];
  for (const [i, m] of brief.key_messages.entries()) {
    if ((m.label as string) === "fato_confirmado") labelProblems.push(`Mensagem ${i + 1} marcada como fato confirmado sem verificação.`);
    if (m.segment_ids.some((id) => !byId.has(id))) labelProblems.push(`Mensagem ${i + 1} cita segmento fora do corte.`);
  }
  labelProblems.push(
    ...textProblems([brief.angle, brief.hook, brief.cta, ...brief.key_messages.map((m) => m.text)], "O briefing"),
    ...textProblems(script.beats.map((b) => `${b.voiceover} ${b.on_screen_text}`), "O roteiro"),
  );

  const checks: DraftGateCheck[] = [
    check("tempos", timeline, "Batidas, cortes de edição e legendas dentro do corte e em ordem."),
    check("citacoes", quoteProblems, "Citações literais conferem com a transcrição."),
    check("rotulos", labelProblems, "Nenhuma mensagem tratada como fato confirmado; sem promessas nem vazamento como oficial."),
    check("plataformas", distributionProblems(ctx.platforms, distribution.versions), "Uma versão por plataforma do projeto, dentro dos limites do app."),
    {
      rule: "plano_nao_renderizado",
      passed: plan.rendered === false,
      detail: "O plano de edição não gerou nenhum arquivo de vídeo.",
    },
    {
      rule: "revisor",
      passed: review.verdict === "aprovado_para_revisao" && review.checks.every((c) => c.passed),
      detail:
        review.verdict === "aprovado_para_revisao" && review.checks.every((c) => c.passed)
          ? "O Revisor de Qualidade liberou o pacote para a revisão humana."
          : `Veredito do Revisor: ${review.verdict}. ${review.issues.slice(0, 2).join(" ")}`.trim(),
    },
  ];
  const failed = checks.filter((c) => !c.passed);
  return { passed: failed.length === 0, checks, reasons: failed.map((c) => c.detail) };
}
