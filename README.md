# GTA DAILY — Central de Conteúdo (plataforma multiagente)

Plataforma para pesquisar, verificar, produzir e distribuir conteúdo curto, começando pelo nicho **GTA VI** do Instagram GTA DAILY.
A arquitetura completa, a matriz de conectores e o plano por blocos estão em [`docs/arquitetura.md`](docs/arquitetura.md).

**Estado atual:** Blocos B (fundação) e C (pesquisa e verificação com fontes rastreáveis, oportunidades, portão de qualidade e orçamento de API). O modelo padrão é o Claude Sonnet 5.5. Inclui:
- projetos;
- execuções de pipeline com estado persistente;
- fila de tarefas com lease, retentativas e idempotência;
- contratos validados por schema;
- auditoria;
- interface em português;
- agentes **Pesquisador** e **Verificador**;
- **Oportunidades** com portão de qualidade e custo estimado por etapa, com orçamento mensal por projeto.

## Stack
- Next.js 16 (App Router) + Tailwind
- Supabase (Postgres, Auth, RLS)
- Claude API (`@anthropic-ai/sdk`)
- Zod
- Vitest + PGlite nos testes e no modo local

## Rodar localmente (sem nenhuma credencial)
```bash
npm install
npm run dev     # http://localhost:3000
```
Sem `DATABASE_URL`, o app entra em **modo local**:
- usa um Postgres embutido (PGlite, em `.data/`) com as mesmas migrations;
- entra com um usuário de teste;
- uma faixa amarela avisa que está nesse modo.

Sem `ANTHROPIC_API_KEY`, as etapas param em **"Exige ação"** com a instrução de correção. Nada é simulado.

## Configurar o ambiente real
Copie `.env.example` para `.env.local`. Na Vercel, cadastre as mesmas variáveis como variáveis de ambiente.

| Variável | Tipo | Onde obter |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | públicas | já preenchidas no `.env.example` (projeto `gta-daily-plataforma`) |
| `DATABASE_URL` | **segredo** | Supabase → Project Settings → Database → Connection string (Transaction pooler) |
| `ANTHROPIC_API_KEY` | **segredo** | console.anthropic.com → API Keys |
| `CLAUDE_MODEL` | opcional | padrão `claude-sonnet-5-5`; `claude-opus-5-5` para mais qualidade (≈2× o custo) |
| `CRON_SECRET` | **segredo** | qualquer valor aleatório longo; protege `/api/worker/tick` |

As migrations ficam em `supabase/migrations/` e já foram aplicadas ao projeto Supabase.

## Processar a fila
- **Interface:** botão "Processar minha fila agora", que processa só as suas tarefas.
- **Worker contínuo:** `npm run worker`. Exige `DATABASE_URL` e pode rodar em várias instâncias.
- **Serverless:** Vercel Cron chamando `GET /api/worker/tick` com `Authorization: Bearer $CRON_SECRET`.

## Verificações
```bash
npm test            # Vitest: orquestrador, segurança/RLS e contratos (PGlite)
npm run typecheck
npm run lint
npm run build
```

## Estrutura
```
src/core/          contratos Zod e contexto de nichos
src/agents/        agentes de função (pesquisador, verificador)
src/connectors/    adaptadores (Claude) e matriz de conectores
src/orchestrator/  engine (fila, lease, retries, auditoria), pipelines e consultas
src/db/            camada SQL (Postgres/Supabase ou PGlite) e migração local
src/app/           interface (Painel, Execuções, Projetos, Agentes) e rota do cron
src/worker/        worker de longa duração
supabase/          migrations e stub de auth para o modo local
tests/             testes automatizados
```
