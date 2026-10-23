import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { EVIDENCE_LABEL, GATE_RULE, OPPORTUNITY_STATUS, PRIORITY, VERIFICATION_STATE } from "@/lib/labels";
import { listOpportunities, sourcesByUrl, type OpportunityListItem } from "@/orchestrator/queries";
import type { SourceRecordRow } from "@/orchestrator/types";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { decideOpportunityAction } from "../../actions";

export const dynamic = "force-dynamic";

function OpportunityCard({ opp, sources }: { opp: OpportunityListItem; sources: Map<string, SourceRecordRow> }) {
  const status = OPPORTUNITY_STATUS[opp.status];
  const verification = VERIFICATION_STATE[opp.verification_state];
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {opp.topic}
          <Badge tone={status.tone} title={status.help}>
            {status.label}
          </Badge>
        </span>
      }
      actions={
        <div className="flex gap-2">
          {opp.status !== "pronta_para_estrategia" && opp.status !== "descartada" && (
            <ActionButton
              action={decideOpportunityAction.bind(null, opp.id, "pronta_para_estrategia")}
              label="Liberar mesmo assim"
              variant="secondary"
              confirm="Liberar para estratégia sem passar no portão de qualidade? A decisão fica registrada."
            />
          )}
          {opp.status !== "descartada" ? (
            <ActionButton action={decideOpportunityAction.bind(null, opp.id, "descartada")} label="Descartar" variant="secondary" />
          ) : (
            <ActionButton action={decideOpportunityAction.bind(null, opp.id, "nova")} label="Reabrir" variant="secondary" />
          )}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge tone={verification.tone}>{verification.label}</Badge>
        <Badge tone={PRIORITY[opp.priority].tone}>{PRIORITY[opp.priority].label}</Badge>
        <Badge title="Interesse editorial estimado pelo Pesquisador (não é probabilidade de viralizar)">Relevância {opp.relevance}/100</Badge>
      </div>
      <p className="mb-1 whitespace-pre-line text-sm">{opp.summary}</p>
      <p className="mb-4 text-xs text-muted">Por que é relevante: {opp.relevance_reason}</p>

      <div className="mb-4 rounded-lg border border-border bg-bg p-3 text-sm">
        <p className="mb-1 font-medium">Portão de qualidade: {opp.quality_gate.passed ? "aprovada" : "reprovada"}</p>
        <ul className="space-y-0.5 text-xs">
          {opp.quality_gate.checks.map((c) => (
            <li key={c.rule}>
              <span className={c.passed ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{c.passed ? "✓" : "✗"}</span>{" "}
              <span className="font-medium">{GATE_RULE[c.rule] ?? c.rule}:</span> <span className="text-muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">
          {opp.claims.length} alegação(ões) verificada(s) · {opp.source_urls.length} fonte(s)
        </summary>
        <ul className="mt-3 space-y-3">
          {opp.claims.map((c) => (
            <li key={c.claim}>
              <p>
                <Badge tone={EVIDENCE_LABEL[c.label]?.tone}>{EVIDENCE_LABEL[c.label]?.label ?? c.label}</Badge>{" "}
                <span className="text-xs text-muted">confiança {c.confidence}</span>
              </p>
              <p className="mt-1">{c.claim}</p>
              {c.notes && <p className="text-xs text-muted">{c.notes}</p>}
              <ul className="mt-1 text-xs">
                {c.evidence_urls.map((u) => (
                  <li key={u} className="truncate">
                    <a href={u} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {sources.get(u)?.title || u}
                    </a>{" "}
                    {sources.get(u)?.kind === "primaria" && <Badge tone="success">fonte primária</Badge>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {(opp.contradictions.length > 0 || opp.caveats.length > 0) && (
          <div className="mt-3 text-xs text-muted">
            {opp.contradictions.map((c) => (
              <p key={c}>Contradição: {c}</p>
            ))}
            {opp.caveats.map((c) => (
              <p key={c}>Ressalva: {c}</p>
            ))}
          </div>
        )}
      </details>

      <p className="mt-3 text-xs text-muted">
        {opp.project_name} · {formatDate(opp.created_at)} ·{" "}
        <Link href={`/execucoes/${opp.run_id}`} className="underline">
          ver execução
        </Link>
        {opp.decided_at && ` · decisão manual em ${formatDate(opp.decided_at)}`}
      </p>
    </Card>
  );
}

export default async function OportunidadesPage() {
  const user = await requireUser();
  const sql = await getDb();
  const opportunities = await listOpportunities(sql, user.id);
  const sourceMaps = new Map<string, Map<string, SourceRecordRow>>();
  for (const projectId of new Set(opportunities.map((o) => o.project_id))) {
    const urls = opportunities.filter((o) => o.project_id === projectId).flatMap((o) => o.source_urls);
    sourceMaps.set(projectId, await sourcesByUrl(sql, projectId, urls));
  }
  return (
    <>
      <PageHeader
        title="Oportunidades"
        description="Cada pesquisa verificada vira uma oportunidade. Só segue para estratégia o que tem fontes rastreáveis e evidência suficiente — ou o que você liberar manualmente."
        actions={
          <Link href="/execucoes#nova" className="text-sm underline">
            Nova pesquisa
          </Link>
        }
      />
      {opportunities.length === 0 ? (
        <Empty>Nenhuma oportunidade ainda. Elas aparecem quando uma pesquisa termina a verificação.</Empty>
      ) : (
        <div className="grid gap-4">
          {opportunities.map((o) => (
            <OpportunityCard key={o.id} opp={o} sources={sourceMaps.get(o.project_id) ?? new Map()} />
          ))}
        </div>
      )}
    </>
  );
}
