import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { AUDIT_LABEL, ERROR_ACTION, ROLE_LABEL, RUN_STATUS, TASK_STATUS } from "@/lib/labels";
import { getOpportunityByRun, getRunDetail } from "@/orchestrator/queries";
import { formatUsd } from "@/connectors/pricing";
import type { TaskRow } from "@/orchestrator/types";
import { Badge, Card, Empty, PageHeader, formatDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { cancelRunAction, processMyQueueAction, retryTaskAction } from "../../../actions";

export const dynamic = "force-dynamic";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-bg p-3 text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function TaskCard({ task, runId }: { task: TaskRow; runId: string }) {
  const status = TASK_STATUS[task.status];
  const errorCode = typeof task.error?.code === "string" ? task.error.code : null;
  const warnings = Array.isArray(task.validation?.warnings) ? (task.validation.warnings as string[]) : [];
  const errors = Array.isArray(task.validation?.errors) ? (task.validation.errors as string[]) : [];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="text-muted">Etapa {task.step_index + 1}</span> {ROLE_LABEL[task.agent_role] ?? task.agent_role}
          <Badge tone={status.tone} title={status.help}>
            {status.label}
          </Badge>
        </span>
      }
      actions={
        task.status === "failed_action_required" ? (
          <ActionButton action={retryTaskAction.bind(null, runId, task.id)} label="Tentar de novo" pendingLabel="Enfileirando…" />
        ) : null
      }
    >
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
        <div>
          <dt className="text-muted">Versão do agente</dt>
          <dd>{task.agent_version}</dd>
        </div>
        <div>
          <dt className="text-muted">Tentativas</dt>
          <dd>
            {task.attempts} de {task.max_attempts}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Correções</dt>
          <dd>
            {task.corrections} de {task.max_corrections}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Custo estimado</dt>
          <dd>{formatUsd(task.cost_usd)}</dd>
        </div>
        <div>
          <dt className="text-muted">Duração</dt>
          <dd>{task.duration_ms != null ? `${(task.duration_ms / 1000).toFixed(1)} s` : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Início</dt>
          <dd>{formatDate(task.started_at)}</dd>
        </div>
        <div>
          <dt className="text-muted">Fim</dt>
          <dd>{formatDate(task.finished_at)}</dd>
        </div>
        {task.status === "failed_retryable" && (
          <div>
            <dt className="text-muted">Próxima tentativa</dt>
            <dd>{formatDate(task.not_before)}</dd>
          </div>
        )}
        {task.reused_from && (
          <div>
            <dt className="text-muted">Reaproveitado de</dt>
            <dd className="truncate">{task.reused_from}</dd>
          </div>
        )}
      </dl>

      {task.error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
          <p className="font-medium">{String(task.error.message ?? "Erro")}</p>
          {errorCode && ERROR_ACTION[errorCode] && <p className="mt-1 text-muted">O que fazer: {ERROR_ACTION[errorCode]}</p>}
          {errorCode && <p className="mt-1 text-xs text-muted">Código: {errorCode}</p>}
        </div>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="mb-4 text-sm">
          {errors.length > 0 && (
            <>
              <p className="font-medium">Problemas encontrados na última validação</p>
              <ul className="ml-5 list-disc text-muted">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          )}
          {warnings.length > 0 && (
            <>
              <p className="mt-2 font-medium">Avisos</p>
              <ul className="ml-5 list-disc text-muted">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <details className="mb-2 text-sm">
        <summary className="cursor-pointer text-muted">Entrada da etapa</summary>
        <div className="mt-2">
          <Json value={task.input} />
        </div>
      </details>
      {task.output && (
        <details className="text-sm" open={task.status === "succeeded"}>
          <summary className="cursor-pointer text-muted">Saída validada</summary>
          <div className="mt-2">
            <Json value={task.output} />
          </div>
        </details>
      )}
    </Card>
  );
}

export default async function ExecucaoPage({ params }: PageProps<"/execucoes/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = await getDb();
  const detail = await getRunDetail(sql, user.id, id);
  if (!detail) notFound();
  const { run, tasks, audit } = detail;
  const opportunity = await getOpportunityByRun(sql, user.id, run.id);
  const totalCost = tasks.reduce((sum, t) => sum + Number(t.cost_usd), 0);
  const status = RUN_STATUS[run.status];
  const active = run.status === "queued" || run.status === "running";
  const finished = run.status === "succeeded" || run.status === "cancelled";

  return (
    <>
      <PageHeader
        title={String(run.input.topic ?? "Execução")}
        description={`Projeto ${run.project_name} · pipeline ${run.pipeline} · criada em ${formatDate(run.created_at)}`}
        actions={
          <div className="flex items-start gap-2">
            {active && <ActionButton action={processMyQueueAction} label="Processar fila agora" variant="secondary" />}
            {!finished && (
              <ActionButton
                action={cancelRunAction.bind(null, run.id)}
                label="Cancelar execução"
                pendingLabel="Cancelando…"
                variant="secondary"
                confirm="Cancelar esta execução? As etapas pendentes não serão executadas."
              />
            )}
          </div>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge tone={status.tone}>{status.label}</Badge>
        {run.goal && <span className="text-sm text-muted">Objetivo: {run.goal}</span>}
        <span className="text-sm text-muted">Custo estimado: {formatUsd(totalCost)}</span>
        {opportunity && (
          <Link href="/oportunidades" className="text-sm underline">
            ver oportunidade gerada
          </Link>
        )}
        <AutoRefresh active={active} />
        <Link href="/execucoes" className="ml-auto text-xs text-muted underline">
          voltar ao histórico
        </Link>
      </div>

      <div className="grid gap-4">
        {tasks.length === 0 ? <Empty>Nenhuma etapa criada ainda.</Empty> : tasks.map((t) => <TaskCard key={t.id} task={t} runId={run.id} />)}

        <Card title="Trilha de auditoria">
          <ol className="space-y-1.5 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3">
                <span className="w-36 shrink-0 text-xs text-muted">{formatDate(a.created_at)}</span>
                <span className="font-medium">{AUDIT_LABEL[a.action] ?? a.action}</span>
                <span className="text-xs text-muted">por {a.actor}</span>
                {Object.keys(a.data ?? {}).length > 0 && (
                  <code className="basis-full break-all pl-0 text-xs text-muted md:pl-39">{JSON.stringify(a.data)}</code>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
