-- Central de Conteúdo (PR 2): rascunhos de produção de um corte (briefing, roteiro, plano de edição, versões por
-- plataforma e revisão) que só viram "aprovados" por decisão humana. Nada é publicado e nenhum arquivo é gerado.

create table public.clip_drafts (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clip_candidates (id) on delete cascade,
  media_id uuid not null references public.media_items (id) on delete cascade,
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null unique references public.pipeline_runs (id) on delete cascade,
  brief jsonb not null,
  script jsonb not null,
  production_plan jsonb not null,
  platform_versions jsonb not null,
  review jsonb not null,
  -- Resultado do portão determinístico (tempos, citações, rótulos, plataformas, veredito do revisor).
  gate jsonb not null,
  status text not null default 'em_revisao' check (status in ('em_revisao', 'aprovado', 'rejeitado')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  -- true quando veio do modo de demonstração (dados fictícios).
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clip_drafts_clip_idx on public.clip_drafts (clip_id, created_at desc);
create index clip_drafts_owner_idx on public.clip_drafts (owner_id, status, created_at desc);

-- RLS: o dono lê; escrita só pelo servidor/worker (credencial de serviço), como nos blocos anteriores.
alter table public.clip_drafts enable row level security;

create policy "dono lê rascunhos" on public.clip_drafts
  for select to authenticated using (owner_id = (select auth.uid()));

revoke insert, update, delete on public.clip_drafts from anon, authenticated;
revoke all on public.clip_drafts from anon;
