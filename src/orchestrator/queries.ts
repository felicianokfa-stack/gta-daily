import { z } from "zod";
import { listNiches } from "@/core/niches";
import { json, type Sql } from "@/db/sql";
import type { AuditRow, OpportunityRow, ProjectRow, RunRow, SourceRecordRow, TaskRow } from "./types";

const PLATFORMS = ["instagram_reels", "instagram_carrossel", "tiktok", "youtube_shorts"] as const;

export const NewProjectInput = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(120),
  niche: z.string().refine((v) => listNiches().some((n) => n.id === v), "Nicho inválido"),
  audience: z.string().trim().max(500).default(""),
  language: z.string().trim().min(2).max(20).default("pt-BR"),
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  /** Orçamento mensal de API em US$ (0 = sem limite). */
  monthly_budget_usd: z.coerce.number().min(0, "Orçamento não pode ser negativo").max(10_000).default(0),
});
export type NewProjectInput = z.input<typeof NewProjectInput>;

export async function createProject(sql: Sql, userId: string, data: NewProjectInput): Promise<ProjectRow> {
  const p = NewProjectInput.parse(data);
  const [row] = await sql.query<ProjectRow>(
    `insert into content_projects (owner_id, name, niche, audience, language, platforms, settings)
     values ($1, $2, $3, $4, $5, array(select jsonb_array_elements_text($6::jsonb)), $7::jsonb)
     returning *`,
    [userId, p.name, p.niche, p.audience, p.language, json(p.platforms), json({ monthly_budget_usd: p.monthly_budget_usd })],
  );
  return row;
}

export async function listProjects(sql: Sql, userId: string): Promise<ProjectRow[]> {
  return sql.query<ProjectRow>(`select * from content_projects where owner_id = $1 order by created_at desc`, [userId]);
}

export interface RunListItem extends RunRow {
  project_name: string;
}

export async function listRuns(sql: Sql, userId: string, limit = 50): Promise<RunListItem[]> {
  return sql.query<RunListItem>(
    `select r.*, p.name as project_name from pipeline_runs r
       join content_projects p on p.id = r.project_id
      where r.owner_id = $1 order by r.created_at desc limit $2`,
    [userId, limit],
  );
}

export interface RunDetail {
  run: RunListItem;
  tasks: TaskRow[];
  audit: AuditRow[];
}

export async function getRunDetail(sql: Sql, userId: string, runId: string): Promise<RunDetail | null> {
  const [run] = await sql.query<RunListItem>(
    `select r.*, p.name as project_name from pipeline_runs r
       join content_projects p on p.id = r.project_id
      where r.id = $1 and r.owner_id = $2`,
    [runId, userId],
  );
  if (!run) return null;
  const tasks = await sql.query<TaskRow>(
    `select * from agent_tasks where run_id = $1 order by step_index, created_at`,
    [runId],
  );
  const audit = await sql.query<AuditRow>(
    `select id, actor, action, data, task_id, created_at from audit_events where run_id = $1 order by id`,
    [runId],
  );
  return { run, tasks, audit };
}

export async function queueStats(sql: Sql, userId: string): Promise<Record<string, number>> {
  const rows = await sql.query<{ status: string; n: number }>(
    `select status::text, count(*)::int as n from agent_tasks where owner_id = $1 group by status`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export interface OpportunityListItem extends OpportunityRow {
  project_name: string;
}

export async function listOpportunities(
  sql: Sql,
  userId: string,
  opts: { status?: OpportunityRow["status"]; limit?: number } = {},
): Promise<OpportunityListItem[]> {
  return sql.query<OpportunityListItem>(
    `select o.*, p.name as project_name from opportunities o
       join content_projects p on p.id = o.project_id
      where o.owner_id = $1 and ($2::text is null or o.status = $2)
      order by case o.status when 'pronta_para_estrategia' then 0 when 'nova' then 1 else 2 end,
               case o.priority when 'alta' then 0 when 'media' then 1 else 2 end,
               o.relevance desc, o.created_at desc
      limit $3`,
    [userId, opts.status ?? null, opts.limit ?? 100],
  );
}

export async function getOpportunityByRun(sql: Sql, userId: string, runId: string): Promise<OpportunityRow | null> {
  const [row] = await sql.query<OpportunityRow>(`select * from opportunities where run_id = $1 and owner_id = $2`, [runId, userId]);
  return row ?? null;
}

/** Fontes registradas para um conjunto de URLs (para mostrar título e tipo). */
export async function sourcesByUrl(sql: Sql, projectId: string, urls: string[]): Promise<Map<string, SourceRecordRow>> {
  if (urls.length === 0) return new Map();
  const rows = await sql.query<SourceRecordRow>(
    `select * from source_records where project_id = $1 and url = any(array(select jsonb_array_elements_text($2::jsonb)))`,
    [projectId, json(urls)],
  );
  return new Map(rows.map((r) => [r.url, r]));
}

/** Custo estimado do mês corrente (UTC) por projeto do usuário. */
export async function monthSpendByProject(sql: Sql, userId: string): Promise<{ project_id: string; name: string; spent: number; budget: number }[]> {
  const rows = await sql.query<{ project_id: string; name: string; spent: string; budget: string | null }>(
    `select p.id as project_id, p.name,
            coalesce((select sum(t.cost_usd) from agent_tasks t
                       where t.project_id = p.id and t.created_at >= date_trunc('month', now())), 0)::text as spent,
            p.settings->>'monthly_budget_usd' as budget
       from content_projects p where p.owner_id = $1 order by p.created_at`,
    [userId],
  );
  return rows.map((r) => ({ project_id: r.project_id, name: r.name, spent: Number(r.spent), budget: Number(r.budget ?? 0) }));
}
