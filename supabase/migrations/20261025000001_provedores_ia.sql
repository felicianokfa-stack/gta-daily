-- Provedores de IA intercambiáveis: rastreabilidade do provedor e marcação de resultado simulado.
-- Não apaga nem altera dados existentes. RLS inalterada (as tabelas já são só-leitura para o dono).

alter table public.agent_tasks
  add column if not exists provider text;

comment on column public.agent_tasks.provider is
  'Provedor de IA que atendeu a tarefa (mock, gemini, ollama, anthropic). null em tarefas anteriores a esta migration.';

alter table public.opportunities
  add column if not exists simulated boolean not null default false;

comment on column public.opportunities.simulated is
  'true quando a oportunidade veio do modo de demonstração: dados fictícios, nunca fatos ou fontes reais.';
