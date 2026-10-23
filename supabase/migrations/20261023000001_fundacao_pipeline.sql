-- Bloco B: fundação do pipeline multiagente.
-- Projetos de conteúdo, execuções de pipeline, fila de tarefas dos agentes e auditoria.
-- Tabelas de domínio (fontes, oportunidades, cortes, publicações, métricas) entram nos blocos C–H.

create type public.task_status as enum (
  'queued',                 -- aguardando execução
  'running',                -- em execução por um worker (com lease)
  'waiting_input',          -- depende de ação do usuário
  'succeeded',              -- saída validada
  'failed_retryable',       -- falhou; será retentada após o backoff
  'failed_action_required', -- falhou; precisa de intervenção
  'cancelled'
);

create type public.pipeline_status as enum (
  'queued',
  'running',
  'waiting_input',
  'succeeded',
  'failed_action_required',
  'cancelled'
);

create table public.content_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  niche text not null check (char_length(niche) between 1 and 60),
  audience text not null default '' check (char_length(audience) <= 500),
  language text not null default 'pt-BR' check (char_length(language) <= 20),
  platforms text[] not null default '{}',
  editorial_rules jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_projects_owner_idx on public.content_projects (owner_id);

create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  pipeline text not null,
  goal text not null default '',
  input jsonb not null default '{}'::jsonb,
  status public.pipeline_status not null default 'queued',
  current_step integer not null default 0,
  idempotency_key text not null,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (project_id, idempotency_key)
);

create index pipeline_runs_owner_idx on public.pipeline_runs (owner_id, created_at desc);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  step_index integer not null,
  agent_role text not null,
  agent_version text not null,
  input jsonb not null,
  input_hash text not null,
  output jsonb,
  status public.task_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  corrections integer not null default 0,
  max_corrections integer not null default 2 check (max_corrections between 0 and 5),
  validation jsonb,
  error jsonb,
  reused_from uuid references public.agent_tasks (id) on delete set null,
  not_before timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  usage jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_tasks_queue_idx on public.agent_tasks (status, not_before, created_at);
create index agent_tasks_run_idx on public.agent_tasks (run_id, step_index);
create index agent_tasks_reuse_idx on public.agent_tasks (agent_role, agent_version, input_hash)
  where status = 'succeeded';

create table public.audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users (id) on delete cascade,
  project_id uuid references public.content_projects (id) on delete cascade,
  run_id uuid references public.pipeline_runs (id) on delete cascade,
  task_id uuid references public.agent_tasks (id) on delete cascade,
  actor text not null,
  action text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_run_idx on public.audit_events (run_id, id);
create index audit_events_task_idx on public.audit_events (task_id, id);

-- RLS: cada usuário só enxerga o que é seu.
-- O worker e o servidor da aplicação acessam com credencial de serviço (sem RLS)
-- e aplicam a checagem de dono no código.
alter table public.content_projects enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.audit_events enable row level security;

create policy "dono lê projetos" on public.content_projects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "dono cria projetos" on public.content_projects
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "dono altera projetos" on public.content_projects
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "dono apaga projetos" on public.content_projects
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "dono lê execuções" on public.pipeline_runs
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "dono lê tarefas" on public.agent_tasks
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "dono lê auditoria" on public.audit_events
  for select to authenticated using (owner_id = (select auth.uid()));

-- Execuções, tarefas e auditoria só são escritas pelo servidor/worker (credencial de serviço),
-- para que o estado do pipeline não possa ser forjado pelo cliente.
revoke insert, update, delete on public.pipeline_runs from anon, authenticated;
revoke insert, update, delete on public.agent_tasks from anon, authenticated;
revoke insert, update, delete on public.audit_events from anon, authenticated;
revoke all on public.content_projects from anon;
revoke all on public.pipeline_runs from anon;
revoke all on public.agent_tasks from anon;
revoke all on public.audit_events from anon;
