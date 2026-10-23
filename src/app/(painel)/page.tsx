import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { RUN_STATUS, TASK_STATUS } from "@/lib/labels";
import { listConnectors } from "@/connectors/registry";
import { listRuns, queueStats } from "@/orchestrator/queries";
import { Badge, Card, Empty, PageHeader, buttonClass, formatDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { processMyQueueAction } from "../actions";
import type { TaskStatus } from "@/core/contracts/common";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const sql = await getDb();
  const [stats, runs] = await Promise.all([queueStats(sql, user.id), listRuns(sql, user.id, 8)]);
  const pendingConnectors = listConnectors().filter((c) => c.state === "pending_credential");
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

      {(actionRequired.length > 0 || pendingConnectors.length > 0) && (
        <Card title="Precisa da sua atenção">
          <ul className="space-y-2 text-sm">
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
