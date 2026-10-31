import { randomUUID } from "node:crypto";
import { agentOutputEnvelope, type AgentRole } from "@/core/contracts/common";
import { getNiche } from "@/core/niches";
import { getAgent } from "@/agents/registry";
import { ConnectorError, type ModelProvider, type ModelUsage } from "@/connectors/types";
import { estimateCost } from "@/connectors/pricing";
import { json, type Sql } from "@/db/sql";
import { InvalidStateError, NotFoundError } from "./errors";
import { inputHash } from "./hash";
import { getPipeline } from "./pipelines";
import type { OpportunityRow, ProcessOutcome, ProjectRow, RunRow, TaskRow } from "./types";

export const DEFAULT_MAX_ATTEMPTS = 4;
export const DEFAULT_MAX_CORRECTIONS = 2;
const MAX_BACKOFF_SECONDS = 300;
/** Resultados reaproveitáveis só dentro desta janela: o nicho é de notícias e envelhece rápido. */
const REUSE_WINDOW_HOURS = 24;

export interface OrchestratorOptions {
  sql: Sql;
  /**
   * Fábrica do provedor de modelo, chamada uma vez por tarefa com o projeto (a escolha do provedor pode vir de
   * `project.settings.ai_provider`). Pode lançar ConnectorError("pending_credential"). Nunca há fallback entre provedores.
   */
  providerFactory: (ctx: { project: ProjectRow }) => ModelProvider;
  workerId?: string;
  leaseSeconds?: number;
}

export interface CreateRunParams {
  userId: string;
  projectId: string;
  pipeline: string;
  goal?: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
}

export { InvalidStateError, NotFoundError };

/**
 * Orquestrador do pipeline: cria execuções, enfileira tarefas, executa um papel por vez,
 * valida a saída por schema + regras de negócio e só então libera a próxima etapa.
 * Todo estado fica no banco: qualquer worker pode retomar uma tarefa após falha.
 */
export class Orchestrator {
  readonly sql: Sql;
  readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly providerFactory: OrchestratorOptions["providerFactory"];

  constructor(opts: OrchestratorOptions) {
    this.sql = opts.sql;
    this.providerFactory = opts.providerFactory;
    this.workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.leaseSeconds = opts.leaseSeconds ?? 300;
  }

  // ------------------------------------------------------------------ criação

  async createRun(params: CreateRunParams): Promise<{ run: RunRow; created: boolean }> {
    const pipeline = getPipeline(params.pipeline);
    const project = await this.getOwnedProject(params.userId, params.projectId);
    // Cada pipeline monta a entrada da execução a partir do projeto (fontes conhecidas, material, etc.).
    const runInput = await pipeline.buildRunInput(this.sql, project, params.input);
    // Valida a entrada da primeira etapa antes de aceitar a execução.
    const firstAgent = getAgent(pipeline.steps[0]);
    const firstInput = firstAgent.buildInput(runInput, {});
    const key = params.idempotencyKey ?? randomUUID();

    return this.sql.transaction(async (tx) => {
      const inserted = await tx.query<RunRow>(
        `insert into pipeline_runs (project_id, owner_id, pipeline, goal, input, status, idempotency_key)
         values ($1, $2, $3, $4, $5::jsonb, 'queued', $6)
         on conflict (project_id, idempotency_key) do nothing
         returning *`,
        [project.id, params.userId, pipeline.id, params.goal ?? "", json(runInput), key],
      );
      if (inserted.length === 0) {
        const [existing] = await tx.query<RunRow>(
          `select * from pipeline_runs where project_id = $1 and idempotency_key = $2`,
          [project.id, key],
        );
        return { run: existing, created: false };
      }
      const run = inserted[0];
      await this.audit(tx, run, null, "user", "run.created", { pipeline: pipeline.id, idempotency_key: key });
      await this.enqueueStep(tx, run, project, 0, firstAgent.role, firstInput);
      return { run, created: true };
    });
  }

  private async enqueueStep(
    tx: Sql,
    run: RunRow,
    project: ProjectRow,
    stepIndex: number,
    role: AgentRole,
    input: Record<string, unknown>,
  ): Promise<TaskRow> {
    const agent = getAgent(role);
    const [task] = await tx.query<TaskRow>(
      `insert into agent_tasks (run_id, project_id, owner_id, step_index, agent_role, agent_version, input, input_hash,
                                max_attempts, max_corrections, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       returning *`,
      [
        run.id,
        run.project_id,
        run.owner_id,
        stepIndex,
        role,
        agent.version,
        json(input),
        inputHash(input),
        project.settings?.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
        project.settings?.max_corrections ?? DEFAULT_MAX_CORRECTIONS,
        `${run.id}:${stepIndex}`,
      ],
    );
    await this.audit(tx, run, task.id, "orquestrador", "task.enqueued", { step: stepIndex, role });
    return task;
  }

  // ------------------------------------------------------------------ execução

  /**
   * Reserva e processa a próxima tarefa pronta. Retorna null se a fila estiver vazia.
   * `ownerId` restringe às tarefas de um usuário (usado pelo botão da interface).
   */
  async processNext(opts: { ownerId?: string } = {}): Promise<{ taskId: string; outcome: ProcessOutcome } | null> {
    const task = await this.claim(opts.ownerId ?? null);
    if (!task) return null;
    const outcome = await this.process(task);
    return { taskId: task.id, outcome };
  }

  /** Processa até `max` tarefas ou até a fila esvaziar. */
  async drain(max = 50, opts: { ownerId?: string } = {}): Promise<{ taskId: string; outcome: ProcessOutcome }[]> {
    const results = [];
    for (let i = 0; i < max; i++) {
      const r = await this.processNext(opts);
      if (!r) break;
      results.push(r);
    }
    return results;
  }

  private async claim(ownerId: string | null): Promise<TaskRow | null> {
    const rows = await this.sql.query<TaskRow>(
      `update agent_tasks t
          set status = 'running', attempts = t.attempts + 1, lease_owner = $1,
              lease_expires_at = now() + ($2 || ' seconds')::interval,
              started_at = now(), updated_at = now()
        where t.id = (
          select id from agent_tasks
           where ((status in ('queued', 'failed_retryable') and not_before <= now())
                  or (status = 'running' and lease_expires_at < now()))
             and ($3::uuid is null or owner_id = $3::uuid)
           order by not_before, created_at
           for update skip locked
           limit 1)
        returning t.*`,
      [this.workerId, String(this.leaseSeconds), ownerId],
    );
    return rows[0] ?? null;
  }

  private async process(task: TaskRow): Promise<ProcessOutcome> {
    const startedAt = Date.now();
    const [run] = await this.sql.query<RunRow>(`select * from pipeline_runs where id = $1`, [task.run_id]);
    const [project] = await this.sql.query<ProjectRow>(`select * from content_projects where id = $1`, [task.project_id]);
    await this.audit(this.sql, run, task.id, this.workerId, "task.claimed", { attempt: task.attempts });

    if (run.status === "cancelled") {
      await this.finishTask(task, "cancelled", {});
      return "cancelled";
    }
    if (run.status === "queued") {
      await this.sql.query(`update pipeline_runs set status = 'running', updated_at = now() where id = $1 and status = 'queued'`, [run.id]);
    }
    if (task.attempts > task.max_attempts) {
      return this.requireAction(task, run, "attempts_exhausted", `Limite de ${task.max_attempts} tentativas atingido (inclui leases expirados).`);
    }

    const agent = getAgent(task.agent_role);
    const parsedInput = agent.inputSchema.safeParse(task.input);
    if (!parsedInput.success) {
      return this.requireAction(task, run, "invalid_input", "Entrada da tarefa fora do contrato.", {
        issues: parsedInput.error.issues,
      });
    }
    const input = parsedInput.data as Record<string, unknown>;

    // O provedor é resolvido antes do reaproveitamento: um resultado só é reutilizado pelo MESMO provedor
    // (nada simulado é entregue como real e vice-versa) e o provedor fica registrado na tarefa.
    let provider: ModelProvider;
    try {
      provider = this.providerFactory({ project });
    } catch (error) {
      return this.handleRunError(task, run, error);
    }
    await this.sql.query(`update agent_tasks set provider = $3 where id = $1 and lease_owner = $2`, [task.id, this.workerId, provider.id]);

    // Reaproveita resultado válido e recente com a mesma entrada, versão do agente e provedor (mesmo dono).
    if (task.corrections === 0) {
      const [cached] = await this.sql.query<TaskRow>(
        `select * from agent_tasks
          where status = 'succeeded' and agent_role = $1 and agent_version = $2 and input_hash = $3
            and owner_id = $4 and id <> $5 and provider = $6
            and finished_at > now() - interval '${REUSE_WINDOW_HOURS} hours'
          order by finished_at desc limit 1`,
        [task.agent_role, task.agent_version, task.input_hash, task.owner_id, task.id, provider.id],
      );
      if (cached?.output) {
        const output = { ...cached.output, task_id: task.id, run_id: run.id, project_id: run.project_id };
        const ok = await this.completeTask(task, output, cached.validation ?? {}, [], startedAt, cached.id);
        if (!ok) return this.leaseLost(task, run);
        await this.audit(this.sql, run, task.id, this.workerId, "task.reused", { from_task: cached.id, provider: provider.id });
        await this.advance(run, project, task, (cached.output as { result: unknown }).result);
        return "reused";
      }
    }

    // Orçamento mensal do projeto (custo estimado a preço de lista).
    const budget = Number(project.settings?.monthly_budget_usd ?? 0);
    if (budget > 0) {
      const spent = await this.monthSpend(project.id);
      if (spent >= budget) {
        return this.requireAction(
          task,
          run,
          "budget_exceeded",
          `Orçamento mensal do projeto atingido (gasto estimado US$ ${spent.toFixed(2)} de US$ ${budget.toFixed(2)}).`,
          { spent_usd: spent, budget_usd: budget },
        );
      }
    }

    let output;
    try {
      output = await agent.run(input, { project, niche: getNiche(project.niche), provider });
    } catch (error) {
      return this.handleRunError(task, run, error);
    }
    // Rastreabilidade: todo registro de uso informa qual provedor atendeu a chamada.
    output.usage = output.usage.map((u) => ({ ...u, provider: u.provider ?? provider.id }));

    // Portão de qualidade: schema do contrato + validações de negócio do papel.
    const parsed = agent.resultSchema.safeParse(output.raw);
    const errors: string[] = [];
    let business = { errors: [] as string[], warnings: [] as string[], evidence: [] as string[], limitations: [] as string[], unconfirmed: [] as string[] };
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((i) => `Contrato: ${i.path.join(".") || "(raiz)"} — ${i.message}`));
    } else {
      business = agent.validate(input, parsed.data, output.retrievedSources);
      errors.push(...business.errors);
    }
    if (errors.length > 0) {
      return this.handleValidationFailure(task, run, input, errors, output.usage);
    }

    const pipeline = getPipeline(run.pipeline);
    const next = pipeline.steps[task.step_index + 1] ?? "fim";
    const envelope = {
      task_id: task.id,
      project_id: run.project_id,
      run_id: run.id,
      agent_role: task.agent_role,
      agent_version: task.agent_version,
      status: "completed" as const,
      result: parsed.data,
      evidence: business.evidence,
      limitations: business.limitations,
      unconfirmed: business.unconfirmed,
      validation: { passed: true as const, warnings: business.warnings },
      next_step: next,
    };
    const envelopeCheck = agentOutputEnvelope(agent.resultSchema).safeParse(envelope);
    if (!envelopeCheck.success) {
      return this.handleValidationFailure(
        task,
        run,
        input,
        envelopeCheck.error.issues.map((i) => `Envelope: ${i.path.join(".")} — ${i.message}`),
        output.usage,
      );
    }

    const ok = await this.completeTask(task, envelope, envelope.validation, output.usage, startedAt, null);
    if (!ok) return this.leaseLost(task, run);
    await this.audit(this.sql, run, task.id, this.workerId, "task.succeeded", {
      provider: provider.id,
      simulated: provider.capabilities?.simulated ?? false,
      warnings: business.warnings,
      usage: output.usage,
      cost_usd: estimateCost(output.usage).usd,
      duration_ms: Date.now() - startedAt,
    });
    await this.advance(run, project, task, parsed.data);
    return "succeeded";
  }

  private async advance(run: RunRow, project: ProjectRow, task: TaskRow, result: unknown): Promise<void> {
    try {
      await this.advanceInTransaction(run, project, task, result);
    } catch (error) {
      // A etapa já foi validada e salva; só o avanço falhou. A execução não pode ficar presa em "em andamento".
      const info = { code: "advance_failed", message: error instanceof Error ? error.message : String(error), task_id: task.id };
      await this.sql.query(
        `update pipeline_runs set status = 'failed_action_required', error = $2::jsonb, updated_at = now()
          where id = $1 and status <> 'cancelled'`,
        [run.id, json(info)],
      );
      await this.audit(this.sql, run, task.id, this.workerId, "run.advance_failed", info);
    }
  }

  private async advanceInTransaction(run: RunRow, project: ProjectRow, task: TaskRow, result: unknown): Promise<void> {
    const pipeline = getPipeline(run.pipeline);
    const nextRole = pipeline.steps[task.step_index + 1];
    await this.sql.transaction(async (tx) => {
      // Trava a execução: se foi cancelada enquanto o agente rodava, não avança.
      const [current] = await tx.query<{ status: string }>(`select status from pipeline_runs where id = $1 for update`, [run.id]);
      if (current?.status === "cancelled") return;
      const previous = await this.previousResults(tx, run.id);
      previous[task.agent_role] = result;
      if (!nextRole) {
        if (pipeline.onSucceeded) {
          const summary = await pipeline.onSucceeded(tx, run, project, previous);
          await this.audit(tx, run, null, "orquestrador", "run.materialized", summary);
        }
        await tx.query(
          `update pipeline_runs set status = 'succeeded', current_step = $2, finished_at = now(), updated_at = now(), error = null
            where id = $1 and status <> 'cancelled'`,
          [run.id, task.step_index],
        );
        await this.audit(tx, run, null, "orquestrador", "run.succeeded", {});
        return;
      }
      const nextInput = getAgent(nextRole).buildInput(run.input, previous);
      await tx.query(
        `update pipeline_runs set status = 'running', current_step = $2, updated_at = now() where id = $1 and status <> 'cancelled'`,
        [run.id, task.step_index + 1],
      );
      await this.enqueueStep(tx, run, project, task.step_index + 1, nextRole, nextInput);
    });
  }

  private async previousResults(tx: Sql, runId: string): Promise<Partial<Record<AgentRole, unknown>>> {
    const rows = await tx.query<{ agent_role: AgentRole; output: { result: unknown } }>(
      `select agent_role, output from agent_tasks where run_id = $1 and status = 'succeeded' order by step_index`,
      [runId],
    );
    return Object.fromEntries(rows.map((r) => [r.agent_role, r.output.result]));
  }

  // ------------------------------------------------------------------ falhas

  private async handleValidationFailure(
    task: TaskRow,
    run: RunRow,
    input: Record<string, unknown>,
    errors: string[],
    usage: ModelUsage[],
  ): Promise<ProcessOutcome> {
    const corrections = task.corrections + 1;
    const validation = { passed: false, errors };
    if (corrections > task.max_corrections || task.attempts >= task.max_attempts) {
      await this.audit(this.sql, run, task.id, this.workerId, "task.validation_failed", { errors, final: true });
      return this.requireAction(task, run, "validation_failed", "A saída do agente não passou na validação após as correções permitidas.", { errors }, validation);
    }
    // Devolve ao mesmo agente com as correções específicas (sem backoff: o erro não é de infraestrutura).
    const rows = await this.sql.query(
      `update agent_tasks set status = 'queued', corrections = $3, input = $4::jsonb, validation = $5::jsonb,
              usage = coalesce(usage, '[]'::jsonb) || $6::jsonb, cost_usd = cost_usd + $7, lease_owner = null,
              lease_expires_at = null, not_before = now(), updated_at = now()
        where id = $1 and lease_owner = $2 and status = 'running' returning id`,
      [task.id, this.workerId, corrections, json({ ...input, correction_notes: errors }), json(validation), json(usage), estimateCost(usage).usd],
    );
    if (rows.length === 0) return this.leaseLost(task, run);
    await this.audit(this.sql, run, task.id, this.workerId, "task.validation_failed", { errors, correction: corrections });
    return "correction_requested";
  }

  private async handleRunError(task: TaskRow, run: RunRow, error: unknown): Promise<ProcessOutcome> {
    const isConnector = error instanceof ConnectorError;
    const retryable = isConnector ? error.retryable : true;
    const info = {
      code: isConnector ? error.code : "unexpected",
      message: error instanceof Error ? error.message : String(error),
      ...(isConnector ? { details: error.details } : {}),
    };
    if (!retryable || task.attempts >= task.max_attempts) {
      await this.audit(this.sql, run, task.id, this.workerId, "task.error", { ...info, final: true });
      return this.requireAction(task, run, info.code, info.message, info);
    }
    const delay = Math.min(MAX_BACKOFF_SECONDS, 5 * 2 ** (task.attempts - 1));
    const rows = await this.sql.query(
      `update agent_tasks set status = 'failed_retryable', error = $3::jsonb, lease_owner = null, lease_expires_at = null,
              not_before = now() + ($4 || ' seconds')::interval, updated_at = now()
        where id = $1 and lease_owner = $2 and status = 'running' returning id`,
      [task.id, this.workerId, json(info), String(delay)],
    );
    if (rows.length === 0) return this.leaseLost(task, run);
    await this.audit(this.sql, run, task.id, this.workerId, "task.retry_scheduled", { ...info, delay_seconds: delay });
    return "retry_scheduled";
  }

  private async requireAction(
    task: TaskRow,
    run: RunRow,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    validation?: Record<string, unknown>,
  ): Promise<ProcessOutcome> {
    const error = { code, message, ...details };
    const done = await this.sql.transaction(async (tx) => {
      const rows = await tx.query(
        `update agent_tasks set status = 'failed_action_required', error = $3::jsonb,
                validation = coalesce($4::jsonb, validation), lease_owner = null, lease_expires_at = null,
                finished_at = now(), updated_at = now()
          where id = $1 and lease_owner = $2 and status = 'running' returning id`,
        [task.id, this.workerId, json(error), validation ? json(validation) : null],
      );
      if (rows.length === 0) return false;
      await tx.query(
        `update pipeline_runs set status = 'failed_action_required', error = $2::jsonb, updated_at = now()
          where id = $1 and status <> 'cancelled'`,
        [run.id, json({ task_id: task.id, ...error })],
      );
      await this.audit(tx, run, task.id, this.workerId, "task.action_required", error);
      return true;
    });
    return done ? "action_required" : this.leaseLost(task, run);
  }

  private async leaseLost(task: TaskRow, run: RunRow): Promise<ProcessOutcome> {
    await this.audit(this.sql, run, task.id, this.workerId, "task.lease_lost", {
      note: "Outro worker assumiu a tarefa; o resultado desta tentativa foi descartado.",
    });
    return "lease_lost";
  }

  private async completeTask(
    task: TaskRow,
    output: Record<string, unknown>,
    validation: Record<string, unknown>,
    usage: ModelUsage[],
    startedAt: number,
    reusedFrom: string | null,
  ): Promise<boolean> {
    const rows = await this.sql.query(
      `update agent_tasks set status = 'succeeded', output = $3::jsonb, validation = $4::jsonb,
              usage = coalesce(usage, '[]'::jsonb) || $5::jsonb, cost_usd = cost_usd + $8, error = null, reused_from = $6,
              lease_owner = null, lease_expires_at = null, finished_at = now(), duration_ms = $7, updated_at = now()
        where id = $1 and lease_owner = $2 and status = 'running' returning id`,
      [task.id, this.workerId, json(output), json(validation), json(usage), reusedFrom, Date.now() - startedAt, estimateCost(usage).usd],
    );
    return rows.length > 0;
  }

  private async finishTask(task: TaskRow, status: "cancelled", error: Record<string, unknown>): Promise<void> {
    await this.sql.query(
      `update agent_tasks set status = $3, error = $4::jsonb, lease_owner = null, lease_expires_at = null,
              finished_at = now(), updated_at = now()
        where id = $1 and lease_owner = $2`,
      [task.id, this.workerId, status, json(error)],
    );
  }

  // ------------------------------------------------------------------ ações do usuário

  async cancelRun(userId: string, runId: string): Promise<void> {
    const run = await this.getOwnedRun(userId, runId);
    if (["succeeded", "cancelled"].includes(run.status)) {
      throw new InvalidStateError("Esta execução já terminou.");
    }
    await this.sql.transaction(async (tx) => {
      await tx.query(`update pipeline_runs set status = 'cancelled', finished_at = now(), updated_at = now() where id = $1`, [run.id]);
      // Tarefas em execução terminam no próximo checkpoint do worker; as pendentes são canceladas já.
      await tx.query(
        `update agent_tasks set status = 'cancelled', finished_at = now(), updated_at = now()
          where run_id = $1 and status in ('queued', 'failed_retryable', 'waiting_input', 'failed_action_required')`,
        [run.id],
      );
      await this.audit(tx, run, null, "user", "run.cancelled", {});
    });
  }

  /** Reenfileira uma tarefa que exigiu intervenção (ex.: após configurar a credencial). */
  async retryTask(userId: string, taskId: string): Promise<void> {
    const [task] = await this.sql.query<TaskRow>(`select * from agent_tasks where id = $1 and owner_id = $2`, [taskId, userId]);
    if (!task) throw new NotFoundError("Tarefa não encontrada.");
    if (task.status !== "failed_action_required") {
      throw new InvalidStateError("Só é possível retentar tarefas que exigem ação.");
    }
    const run = await this.getOwnedRun(userId, task.run_id);
    if (run.status === "cancelled") throw new InvalidStateError("A execução foi cancelada.");
    const { correction_notes: _drop, ...cleanInput } = task.input;
    await this.sql.transaction(async (tx) => {
      await tx.query(
        `update agent_tasks set status = 'queued', attempts = 0, corrections = 0, error = null, finished_at = null,
                input = $2::jsonb, not_before = now(), updated_at = now() where id = $1`,
        [task.id, json({ ...cleanInput, correction_notes: [] })],
      );
      await tx.query(`update pipeline_runs set status = 'running', error = null, updated_at = now() where id = $1`, [run.id]);
      await this.audit(tx, run, task.id, "user", "task.retry_requested", {});
    });
  }

  /** Decisão humana sobre uma oportunidade (descartar, marcar pronta ou reabrir), com auditoria. */
  async decideOpportunity(userId: string, opportunityId: string, status: OpportunityRow["status"]): Promise<void> {
    const [opp] = await this.sql.query<OpportunityRow>(`select * from opportunities where id = $1 and owner_id = $2`, [
      opportunityId,
      userId,
    ]);
    if (!opp) throw new NotFoundError("Oportunidade não encontrada.");
    if (opp.status === status) return;
    const run = await this.getOwnedRun(userId, opp.run_id);
    await this.sql.transaction(async (tx) => {
      await tx.query(
        `update opportunities set status = $2, decided_by = 'user', decided_at = now(), updated_at = now() where id = $1`,
        [opp.id, status],
      );
      await this.audit(tx, run, null, "user", "opportunity.decided", {
        opportunity_id: opp.id,
        from: opp.status,
        to: status,
        quality_gate_passed: opp.quality_gate.passed,
      });
    });
  }

  /** Custo estimado do mês corrente (UTC) de um projeto. */
  async monthSpend(projectId: string): Promise<number> {
    const [row] = await this.sql.query<{ total: string }>(
      `select coalesce(sum(cost_usd), 0)::text as total from agent_tasks
        where project_id = $1 and created_at >= date_trunc('month', now())`,
      [projectId],
    );
    return Number(row.total);
  }

  // ------------------------------------------------------------------ util

  async getOwnedProject(userId: string, projectId: string): Promise<ProjectRow> {
    const [project] = await this.sql.query<ProjectRow>(
      `select * from content_projects where id = $1 and owner_id = $2`,
      [projectId, userId],
    );
    if (!project) throw new NotFoundError("Projeto não encontrado.");
    return project;
  }

  async getOwnedRun(userId: string, runId: string): Promise<RunRow> {
    const [run] = await this.sql.query<RunRow>(`select * from pipeline_runs where id = $1 and owner_id = $2`, [runId, userId]);
    if (!run) throw new NotFoundError("Execução não encontrada.");
    return run;
  }

  private async audit(
    sql: Sql,
    run: RunRow,
    taskId: string | null,
    actor: string,
    action: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await sql.query(
      `insert into audit_events (owner_id, project_id, run_id, task_id, actor, action, data)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [run.owner_id, run.project_id, run.id, taskId, actor, action, json(data)],
    );
  }
}
