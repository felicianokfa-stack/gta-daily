import { z } from "zod";
import { listNiches } from "@/core/niches";
import { json, type Sql } from "@/db/sql";
import type { AuditRow, ProjectRow, RunRow, TaskRow } from "./types";

const PLATFORMS = ["instagram_reels", "instagram_carrossel", "tiktok", "youtube_shorts"] as const;

export const NewProjectInput = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(120),
  niche: z.string().refine((v) => listNiches().some((n) => n.id === v), "Nicho inválido"),
  audience: z.string().trim().max(500).default(""),
  language: z.string().trim().min(2).max(20).default("pt-BR"),
  platforms: z.array(z.enum(PLATFORMS)).default([]),
});
export type NewProjectInput = z.input<typeof NewProjectInput>;

export async function createProject(sql: Sql, userId: string, data: NewProjectInput): Promise<ProjectRow> {
  const p = NewProjectInput.parse(data);
  const [row] = await sql.query<ProjectRow>(
    `insert into content_projects (owner_id, name, niche, audience, language, platforms)
     values ($1, $2, $3, $4, $5, array(select jsonb_array_elements_text($6::jsonb)))
     returning *`,
    [userId, p.name, p.niche, p.audience, p.language, json(p.platforms)],
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
