import { z } from "zod";
import { listNiches } from "@/core/niches";
import { MediaAuthorization } from "@/core/contracts/content";
import { SAMPLE_MEDIA } from "@/core/sample-media";
import { Transcript, parseTimestamp, parseTranscriptText, TranscriptParseError } from "@/core/transcript";
import { json, type Sql } from "@/db/sql";
import { NotFoundError } from "./errors";
import type {
  AuditRow,
  ClipCandidateRow,
  MediaRow,
  OpportunityRow,
  ProjectRow,
  RunRow,
  SourceRecordRow,
  TaskRow,
} from "./types";

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

// ------------------------------------------------------------------ Central de Conteúdo: biblioteca

export const NewMediaInput = z.object({
  projectId: z.uuid("Escolha um projeto"),
  kind: z.enum(["link", "transcricao"]),
  title: z.string().trim().min(1, "Informe um título").max(200),
  url: z.string().trim().max(2000).optional().default(""),
  /** Duração total no formato mm:ss, h:mm:ss ou em segundos. */
  duration: z.string().trim().min(1, "Informe a duração (ex.: 2:30)"),
  transcript_text: z.string().min(1, "Cole a transcrição com as marcações de tempo"),
  notes: z.string().trim().max(1000).optional().default(""),
  authorized: z.boolean(),
  authorization_basis: z.string().trim().max(500).default(""),
});
export type NewMediaInput = z.input<typeof NewMediaInput>;

async function assertProjectOwner(sql: Sql, userId: string, projectId: string): Promise<ProjectRow> {
  const [project] = await sql.query<ProjectRow>(`select * from content_projects where id = $1 and owner_id = $2`, [projectId, userId]);
  if (!project) throw new NotFoundError("Projeto não encontrado.");
  return project;
}

async function auditUser(sql: Sql, userId: string, projectId: string | null, action: string, data: Record<string, unknown>) {
  await sql.query(
    `insert into audit_events (owner_id, project_id, actor, action, data) values ($1, $2, 'user', $3, $4::jsonb)`,
    [userId, projectId, action, json(data)],
  );
}

/** Cadastra um material: referência + metadados + transcrição com tempos. Exige a declaração de autorização. */
export async function createMedia(sql: Sql, userId: string, data: NewMediaInput): Promise<MediaRow> {
  const p = NewMediaInput.parse(data);
  const project = await assertProjectOwner(sql, userId, p.projectId);
  const authorization = MediaAuthorization.parse({ declared: p.authorized, basis: p.authorization_basis });
  if (p.kind === "link") {
    if (!p.url) throw new TranscriptParseError("Informe o link do material (ele é só uma referência: nada é baixado).");
    try {
      const u = new URL(p.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocolo");
    } catch {
      throw new TranscriptParseError("O link precisa começar com http:// ou https://.");
    }
  }
  const duration = parseTimestamp(p.duration);
  if (duration === null || duration < 1 || duration > 86_400) {
    throw new TranscriptParseError('Duração inválida. Use "mm:ss", "h:mm:ss" ou segundos (ex.: 2:30).');
  }
  const transcript = parseTranscriptText(p.transcript_text, Math.round(duration));
  const [row] = await sql.query<MediaRow>(
    `insert into media_items (project_id, owner_id, kind, title, url, duration_seconds, metadata, transcript, usage_rights, is_sample)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, false)
     returning *`,
    [project.id, userId, p.kind, p.title, p.url || null, Math.round(duration), json({ observacoes: p.notes }), json(transcript), json(authorization)],
  );
  await auditUser(sql, userId, project.id, "media.created", { media_id: row.id, kind: p.kind, segments: transcript.length });
  return row;
}

/** Material de exemplo FICTÍCIO (marcado como tal), para testar o fluxo sem usar conteúdo de terceiros. */
export async function createSampleMedia(sql: Sql, userId: string, projectId: string): Promise<MediaRow> {
  const project = await assertProjectOwner(sql, userId, projectId);
  const transcript = Transcript.parse(parseTranscriptText(SAMPLE_MEDIA.transcript_text, SAMPLE_MEDIA.duration_seconds));
  const [row] = await sql.query<MediaRow>(
    `insert into media_items (project_id, owner_id, kind, title, url, duration_seconds, metadata, transcript, usage_rights, is_sample)
     values ($1, $2, 'exemplo', $3, null, $4, $5::jsonb, $6::jsonb, $7::jsonb, true)
     returning *`,
    [project.id, userId, SAMPLE_MEDIA.title, SAMPLE_MEDIA.duration_seconds, json(SAMPLE_MEDIA.metadata), json(transcript), json(SAMPLE_MEDIA.authorization)],
  );
  await auditUser(sql, userId, project.id, "media.created", { media_id: row.id, kind: "exemplo", segments: transcript.length });
  return row;
}

export interface MediaListItem extends MediaRow {
  project_name: string;
  analyses: number;
  candidates: number;
}

export async function listMedia(sql: Sql, userId: string): Promise<MediaListItem[]> {
  return sql.query<MediaListItem>(
    `select m.*, p.name as project_name,
            (select count(*)::int from pipeline_runs r where r.pipeline = 'analise_midia' and r.input->>'media_id' = m.id::text) as analyses,
            (select count(*)::int from clip_candidates c where c.media_id = m.id) as candidates
       from media_items m join content_projects p on p.id = m.project_id
      where m.owner_id = $1 order by m.created_at desc`,
    [userId],
  );
}

export async function getMedia(sql: Sql, userId: string, mediaId: string): Promise<(MediaRow & { project_name: string }) | null> {
  const [row] = await sql.query<MediaRow & { project_name: string }>(
    `select m.*, p.name as project_name from media_items m join content_projects p on p.id = m.project_id
      where m.id = $1 and m.owner_id = $2`,
    [mediaId, userId],
  );
  return row ?? null;
}

export async function listClipCandidates(sql: Sql, userId: string, mediaId: string): Promise<ClipCandidateRow[]> {
  return sql.query<ClipCandidateRow>(
    `select * from clip_candidates where media_id = $1 and owner_id = $2 order by created_at desc, score desc, position`,
    [mediaId, userId],
  );
}

export async function listMediaRuns(sql: Sql, userId: string, mediaId: string): Promise<RunRow[]> {
  return sql.query<RunRow>(
    `select * from pipeline_runs where owner_id = $1 and pipeline = 'analise_midia' and input->>'media_id' = $2
      order by created_at desc limit 10`,
    [userId, mediaId],
  );
}

/** Marca um corte candidato como selecionado, descartado ou de volta a sugerido (decisão do usuário, auditada). */
export async function setClipStatus(
  sql: Sql,
  userId: string,
  clipId: string,
  status: ClipCandidateRow["status"],
): Promise<void> {
  const [clip] = await sql.query<ClipCandidateRow>(`select * from clip_candidates where id = $1 and owner_id = $2`, [clipId, userId]);
  if (!clip) throw new NotFoundError("Corte não encontrado.");
  if (clip.status === status) return;
  await sql.query(`update clip_candidates set status = $2, updated_at = now() where id = $1`, [clip.id, status]);
  await auditUser(sql, userId, clip.project_id, "clip.status_changed", { clip_id: clip.id, from: clip.status, to: status });
}
