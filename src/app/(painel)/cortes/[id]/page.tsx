import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { DRAFT_STATUS, EVIDENCE_LABEL, PLATFORM_LABEL } from "@/lib/labels";
import { formatTimestamp } from "@/core/transcript";
import { getDraft } from "@/orchestrator/queries";
import { Badge, Card, PageHeader, formatDate } from "@/components/ui";
import { SimulatedBanner } from "@/components/simulated-banner";
import { DecisionForm } from "../decision-form";

export const dynamic = "force-dynamic";

const VERDICT = {
  aprovado_para_revisao: { label: "Liberado para revisão humana", tone: "success" },
  ajustes: { label: "Pede ajustes", tone: "warning" },
  reprovado: { label: "Reprovado pelo revisor", tone: "danger" },
} as const;

const t = (s: number) => `${formatTimestamp(s)} (${s}s)`;

export default async function RascunhoPage({ params }: PageProps<"/cortes/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getDraft(await getDb(), user.id, id);
  if (!d) notFound();
  const status = DRAFT_STATUS[d.status];
  const verdict = VERDICT[d.review.verdict];

  return (
    <>
      <PageHeader
        title={d.clip_title}
        description={`Projeto ${d.project_name} · material “${d.media_title}” · criado em ${formatDate(d.created_at)}`}
        actions={
          <Link href={`/execucoes/${d.run_id}`} className="text-sm underline">
            ver execução
          </Link>
        }
      />
      {d.simulated && <SimulatedBanner />}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge tone={d.gate.passed ? "success" : "danger"}>{d.gate.passed ? "Portão de qualidade ✓" : "Portão reprovado"}</Badge>
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        {d.simulated && <Badge tone="warning">Simulado</Badge>}
      </div>

      <div className="grid gap-6">
        <Card title="Portão de qualidade (verificação automática, sem IA)">
          <ul className="space-y-1 text-sm">
            {d.gate.checks.map((c) => (
              <li key={c.rule}>
                <span className={c.passed ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{c.passed ? "✓" : "✗"}</span>{" "}
                <span className="font-medium">{c.rule}:</span> <span className="text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Decisão">
          <DecisionForm draftId={d.id} status={d.status} gatePassed={d.gate.passed} />
          {d.decided_at && (
            <p className="mt-3 text-xs text-muted">
              Última decisão em {formatDate(d.decided_at)}
              {d.decision_note ? ` — “${d.decision_note}”` : ""}
            </p>
          )}
        </Card>

        <Card title="Briefing (Estrategista)">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Ângulo</dt>
              <dd>{d.brief.angle}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Gancho</dt>
              <dd>{d.brief.hook}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Público</dt>
              <dd>{d.brief.audience}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Chamada para ação</dt>
              <dd>{d.brief.cta}</dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-2 text-sm">
            {d.brief.key_messages.map((m, i) => (
              <li key={i}>
                <Badge tone={EVIDENCE_LABEL[m.label]?.tone}>{EVIDENCE_LABEL[m.label]?.label ?? m.label}</Badge> {m.text}{" "}
                <span className="text-xs text-muted">(trechos {m.segment_ids.join(", ")})</span>
              </li>
            ))}
          </ul>
          {d.brief.cautions.length > 0 && <p className="mt-3 text-xs text-muted">Cuidados: {d.brief.cautions.join(" · ")}</p>}
        </Card>

        <Card title="Roteiro (Roteirista)">
          <ol className="space-y-2 text-sm">
            {d.script.beats.map((b, i) => (
              <li key={i} className="rounded-lg border border-border p-2.5">
                <p className="text-xs text-muted">
                  {t(b.t_start)} → {t(b.t_end)}
                  {b.segment_id !== null ? ` · trecho ${b.segment_id}` : ""}
                </p>
                <p>{b.voiceover}</p>
                {b.on_screen_text && <p className="text-xs text-muted">Na tela: {b.on_screen_text}</p>}
                {b.quote && <p className="text-xs text-muted">Citação literal: “{b.quote}”</p>}
              </li>
            ))}
          </ol>
          {d.script.disclaimers.length > 0 && <p className="mt-3 text-xs text-muted">Ressalvas: {d.script.disclaimers.join(" · ")}</p>}
        </Card>

        <Card title="Plano de edição (Produtor Audiovisual)">
          <p className="mb-3 rounded-lg border border-border bg-bg p-2.5 text-xs">
            <strong>Isto é um plano, não um vídeo.</strong> Nenhum arquivo foi gerado ({d.production_plan.format}).
          </p>
          <p className="mb-3 text-sm">{d.production_plan.summary}</p>
          <p className="mb-1 text-xs font-medium">Cortes</p>
          <ul className="mb-3 space-y-1 text-xs">
            {d.production_plan.cuts.map((c, i) => (
              <li key={i}>
                {t(c.t_start)} → {t(c.t_end)}: {c.framing}
                {c.note ? ` — ${c.note}` : ""}
              </li>
            ))}
          </ul>
          <p className="mb-1 text-xs font-medium">Legendas</p>
          <ul className="mb-3 space-y-1 text-xs">
            {d.production_plan.subtitles.map((s, i) => (
              <li key={i}>
                {t(s.t_start)} → {t(s.t_end)}: {s.text}
              </li>
            ))}
          </ul>
          {d.production_plan.assets_needed.length > 0 && <p className="text-xs text-muted">Ativos necessários: {d.production_plan.assets_needed.join(" · ")}</p>}
          {d.production_plan.audio_notes.length > 0 && <p className="text-xs text-muted">Áudio: {d.production_plan.audio_notes.join(" · ")}</p>}
        </Card>

        <Card title="Versões por plataforma (Distribuidor)">
          <ul className="grid gap-3 md:grid-cols-2">
            {d.platform_versions.map((v) => (
              <li key={v.platform} className="rounded-lg border border-border p-3 text-sm">
                <p className="mb-1 font-medium">{PLATFORM_LABEL[v.platform] ?? v.platform}</p>
                <p>{v.title}</p>
                <p className="mt-1 whitespace-pre-line text-xs text-muted">{v.caption}</p>
                <p className="mt-1 text-xs">{v.hashtags.join(" ")}</p>
                {v.cover_text && <p className="mt-1 text-xs text-muted">Capa: {v.cover_text}</p>}
                {v.timing_note && <p className="text-xs text-muted">Horário: {v.timing_note}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Nada foi publicado. Os limites usados são os do app: confira nas plataformas antes de postar. O Instagram Carrossel (slides) não entra na produção de cortes de vídeo.</p>
        </Card>

        <Card title="Revisão (Revisor de Qualidade)">
          <p className="mb-2 text-sm">{d.review.summary}</p>
          <ul className="space-y-1 text-xs">
            {d.review.checks.map((c, i) => (
              <li key={i}>
                <span className={c.passed ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{c.passed ? "✓" : "✗"}</span>{" "}
                <span className="font-medium">{c.rule}</span> <span className="text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
          {d.review.issues.length > 0 && <p className="mt-2 text-xs">Problemas: {d.review.issues.join(" · ")}</p>}
          {d.review.suggested_fixes.length > 0 && <p className="text-xs text-muted">Correções sugeridas: {d.review.suggested_fixes.join(" · ")}</p>}
        </Card>
      </div>
    </>
  );
}
