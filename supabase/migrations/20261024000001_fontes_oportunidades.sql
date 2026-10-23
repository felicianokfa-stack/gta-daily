-- Bloco C: fontes rastreáveis, oportunidades com portão de qualidade e custo por tarefa.

-- Custo estimado (preço de lista) acumulado por tarefa, para orçamento mensal por projeto.
alter table public.agent_tasks add column cost_usd numeric(12, 4) not null default 0;
create index agent_tasks_project_cost_idx on public.agent_tasks (project_id, created_at);

-- Fontes que os agentes realmente recuperaram, registradas uma vez por projeto.
create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  url text not null check (char_length(url) <= 2000),
  title text not null default '',
  publisher text,
  published_at text,
  kind text not null check (kind in ('primaria', 'secundaria')),
  first_seen_run uuid references public.pipeline_runs (id) on delete set null,
  last_seen_run uuid references public.pipeline_runs (id) on delete set null,
  times_seen integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, url)
);

create index source_records_project_idx on public.source_records (project_id, updated_at desc);

-- Oportunidade de conteúdo gerada por uma execução de pesquisa + verificação.
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null unique references public.pipeline_runs (id) on delete cascade,
  topic text not null,
  summary text not null default '',
  verification_state text not null check (verification_state in ('verificada', 'parcial', 'nao_verificada')),
  relevance integer not null check (relevance between 0 and 100),
  relevance_reason text not null default '',
  priority text not null check (priority in ('alta', 'media', 'baixa')),
  claims jsonb not null default '[]'::jsonb,
  contradictions jsonb not null default '[]'::jsonb,
  caveats jsonb not null default '[]'::jsonb,
  source_urls text[] not null default '{}',
  quality_gate jsonb not null,
  status text not null default 'nova' check (status in ('nova', 'pronta_para_estrategia', 'descartada')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_project_idx on public.opportunities (project_id, status, relevance desc);
create index opportunities_owner_idx on public.opportunities (owner_id, created_at desc);

-- RLS: o dono lê; escrita só pelo servidor/worker (credencial de serviço), como no Bloco B.
alter table public.source_records enable row level security;
alter table public.opportunities enable row level security;

create policy "dono lê fontes" on public.source_records
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "dono lê oportunidades" on public.opportunities
  for select to authenticated using (owner_id = (select auth.uid()));

revoke insert, update, delete on public.source_records from anon, authenticated;
revoke insert, update, delete on public.opportunities from anon, authenticated;
revoke all on public.source_records from anon;
revoke all on public.opportunities from anon;
