-- Central de Conteúdo (PR 1): biblioteca de materiais e candidatos a corte.
-- Material = referência (link) + metadados + transcrição com marcações de tempo informadas pelo usuário.
-- Nenhum vídeo é baixado nem armazenado.

create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('link', 'transcricao', 'exemplo')),
  title text not null check (char_length(title) between 1 and 200),
  -- Só referência: o app não baixa nem republica o vídeo.
  url text check (url is null or char_length(url) <= 2000),
  duration_seconds integer not null check (duration_seconds between 1 and 86400),
  metadata jsonb not null default '{}'::jsonb,
  -- [{ "id": 1, "start_s": 0, "end_s": 12.5, "text": "..." }, ...] ordenado e sem sobreposição
  transcript jsonb not null check (jsonb_typeof(transcript) = 'array'),
  -- { "declared": true, "basis": "..." }: declaração do usuário de que pode usar o material
  usage_rights jsonb not null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index media_items_project_idx on public.media_items (project_id, created_at desc);
create index media_items_owner_idx on public.media_items (owner_id, created_at desc);

-- Cortes sugeridos pelo Analista de Conteúdo para uma análise (execução) de um material.
create table public.clip_candidates (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media_items (id) on delete cascade,
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  position integer not null check (position >= 0),
  title text not null check (char_length(title) between 1 and 200),
  justification text not null check (char_length(justification) >= 1),
  start_s numeric(10, 2) not null check (start_s >= 0),
  end_s numeric(10, 2) not null,
  segment_ids jsonb not null default '[]'::jsonb,
  -- Interesse editorial estimado (0–100). Não é probabilidade de viralizar.
  score integer not null check (score between 0 and 100),
  score_reason text not null default '',
  risks jsonb not null default '[]'::jsonb,
  status text not null default 'sugerido' check (status in ('sugerido', 'selecionado', 'descartado')),
  -- true quando veio do modo de demonstração (dados fictícios).
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_s > start_s),
  unique (run_id, position)
);

create index clip_candidates_media_idx on public.clip_candidates (media_id, score desc);
create index clip_candidates_owner_idx on public.clip_candidates (owner_id, created_at desc);

-- RLS: o dono lê; escrita só pelo servidor/worker (credencial de serviço), como nos blocos anteriores.
alter table public.media_items enable row level security;
alter table public.clip_candidates enable row level security;

create policy "dono lê materiais" on public.media_items
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "dono lê candidatos a corte" on public.clip_candidates
  for select to authenticated using (owner_id = (select auth.uid()));

revoke insert, update, delete on public.media_items from anon, authenticated;
revoke insert, update, delete on public.clip_candidates from anon, authenticated;
revoke all on public.media_items from anon;
revoke all on public.clip_candidates from anon;
