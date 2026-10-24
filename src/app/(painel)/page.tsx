import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { OPPORTUNITY_STATUS, PRIORITY, RUN_STATUS, TASK_STATUS } from "@/lib/labels";
import { formatUsd } from "@/connectors/pricing";
import { listConnectors } from "@/connectors/registry";
import { resolveProviderId } from "@/connectors/ai/factory";
import { listOpportunities, listProjects, listRuns, monthSpendByProject, queueStats } from "@/orchestrator/queries";
import { Badge, Card, Empty, PageHeader, buttonClass, formatDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { processMyQueueAction } from "../actions";
import type { TaskStatus } from "@/core/contracts/common";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const sql = await getDb();
  const [stats, runs, best, spend] = await Promise.all([
    queueStats(sql, user.id),
    listRuns(sql, user.id, 8),
    listOpportunities(sql, user.id, { limit: 5 }),
    monthSpendByProject(sql, user.id),
  ]);
  const topOpportunities = best.filter((o) => o.status !== "descartada");
  // Conectores opcionais (provedores de IA que não foram escolhidos, YouTube) não são pendências: o que importa
  // é cada projeto ter um provedor de IA escolhido.
  const pendingConnectors = listConnectors().filter(
    (c) => c.state === "pending_credential" && !c.id.startsWith("ia_") && c.id !== "youtube",
  );
  const projectsWithoutProvider = (await listProjects(sql, user.id)).filter((p) => !resolveProviderId(p.settings));
  const actionRequired = runs.filter((r) => r.status === "failed_action_required");

  return (
    <>
      <PageHeader
        title="Painel"
        description="Visão geral do pipeline: o que está na fila, o que precisa de você e as execuções recentes."
        actions={
          <div className="flex items-start gap-2">
            <ActionButton action={processMyQueueAction} label="Processar minha fila agora" pendingLabel="Processando…" variant="secondary" />
            <Link href="/execucoes#nova" className={buttonClass}>
              Nova pesquisa
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["queued", "running", "failed_action_required", "succeeded"] as TaskStatus[]).map((s) => (
          <div key={s} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">{TASK_STATUS[s].label}</p>
            <p className="mt-1 text-2xl font-semibold">{stats[s] ?? 0}</p>
            <p className="mt-1 text-xs text-muted">etapas</p>
          </div>
        ))}
      </div>

      {(actionRequired.length > 0 || pendingConnectors.length > 0 || projectsWithoutProvider.length > 0) && (
        <Card title="Precisa da sua atenção">
          <ul className="space-y-2 text-sm">
            {projectsWithoutProvider.map((p) => (
              <li key={p.id}>
                <Badge tone="warning">Sem provedor de IA</Badge> {p.name} —{" "}
                <Link href="/configuracoes" className="underline underline-offset-2">
                  escolha um provedor em Configurações
                </Link>{" "}
                <span className="text-muted">(demonstração sem custo ou IA real).</span>
              </li>
            ))}
            {actionRequired.map((r) => (
              <li key={r.id}>
                <Badge tone="danger">Exige ação</Badge>{" "}
                <Link href={`/execucoes/${r.id}`} className="underline underline-offset-2">
                  {String(r.input.topic ?? r.id)}
                </Link>
              </li>
            ))}
            {pendingConnectors.map((c) => (
              <li key={c.id}>
                <Badge tone="warning">Falta credencial</Badge> {c.name} — <span className="text-muted">{c.notes}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card title="Melhores oportunidades" actions={<Link href="/oportunidades" className="text-xs text-muted underline">ver todas</Link>}>
            {topOpportunities.length === 0 ? (
              <Empty>Nenhuma oportunidade ainda. Elas surgem quando uma pesquisa termina a verificação.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {topOpportunities.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <Link href="/oportunidades" className="min-w-0 flex-1 truncate hover:underline">
                      {o.topic}
                    </Link>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge tone={PRIORITY[o.priority].tone}>{PRIORITY[o.priority].label}</Badge>
                      <Badge tone={OPPORTUNITY_STATUS[o.status].tone}>{OPPORTUNITY_STATUS[o.status].label}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Gasto de API no mês">
          {spend.length === 0 ? (
            <p className="text-sm text-muted">Nenhum projeto.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {spend.map((p) => (
                <li key={p.project_id}>
                  <p className="flex justify-between gap-2">
                    <span>{p.name}</span>
                    <span className="font-medium">{formatUsd(p.spent)}</span>
                  </p>
                  {p.budget > 0 ? (
                    <>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
                        <div className="h-full bg-accent" style={{ width: `${Math.min(100, (p.spent / p.budget) * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted">de {formatUsd(p.budget)} de orçamento</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted">sem limite definido</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Estimativa a preço de lista, calculada pelos tokens e buscas registrados.</p>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Execuções recentes" actions={<Link href="/execucoes" className="text-xs text-muted underline">ver todas</Link>}>
          {runs.length === 0 ? (
            <Empty>Nenhuma execução ainda. Crie um projeto e comece uma pesquisa.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/execucoes/${r.id}`} className="truncate hover:underline">
                    {String(r.input.topic ?? r.id)}
                    <span className="ml-2 text-xs text-muted">{r.project_name}</span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted">{formatDate(r.created_at)}</span>
                    <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
