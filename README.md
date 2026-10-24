# GTA DAILY — Central de Conteúdo (plataforma multiagente)

Plataforma para pesquisar, verificar, produzir e distribuir conteúdo curto, começando pelo nicho **GTA VI** do Instagram GTA DAILY.
A arquitetura completa, a matriz de conectores e o plano por blocos estão em [`docs/arquitetura.md`](docs/arquitetura.md).

**Estado atual:** Blocos B (fundação) e C (pesquisa e verificação com fontes rastreáveis, oportunidades, portão de qualidade e orçamento de API), mais a **camada de provedores de IA intercambiáveis** (demonstração, Gemini, Ollama e Claude). Inclui:
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
- Provedores de IA intercambiáveis: demonstração (`mock`), Google Gemini (REST), Ollama (local) e Claude API (`@anthropic-ai/sdk`)
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

## Provedores de IA
Os agentes só falam com a interface `ModelProvider`; o provedor é escolhido por configuração, **sempre de forma explícita**:

| Provedor | O que é | Credencial |
|---|---|---|
| `mock` | **Demonstração**: respostas fictícias, determinísticas e marcadas `[SIMULADO]`; sem rede e sem custo | nenhuma |
| `gemini` | IA real via API oficial do Google Gemini (plano gratuito do AI Studio) | `GEMINI_API_KEY` |
| `ollama` | Modelo local (opcional; use no worker local) | `OLLAMA_MODEL` |
| `anthropic` | Claude, API paga, preservada para ativação futura | `ANTHROPIC_API_KEY` |

- **Como escolher:** `AI_PROVIDER` define o padrão do servidor; em **Configurações** cada projeto pode usar outro (salvo em `content_projects.settings.ai_provider`). Trocar de provedor não altera projetos, fontes, roteiros nem histórico.
- **Sem provedor escolhido**, as etapas param em **"Exige ação"**: o modo de demonstração nunca é ligado por omissão.
- **Sem fallback:** se o provedor escolhido falhar ou esgotar o limite gratuito, a etapa fica em "Exige ação" e você decide esperar ou trocar. A API da Anthropic nunca é usada automaticamente.
- **Rastreabilidade:** cada tarefa grava o provedor (`agent_tasks.provider`) e o uso registra o provedor e o modelo. Resultados de provedores diferentes não são reaproveitados entre si.
- **Demonstração:** oportunidades geradas ficam marcadas como **Simulado** (`opportunities.simulated`), as telas exibem "Modo de demonstração — resultado simulado" e as fontes fictícias (domínio reservado `.invalid`) nunca entram em `source_records`. Hoje só Pesquisador e Verificador têm resposta de demonstração.
- **Sem busca na web** (mock, Ollama, Gemini sem `GEMINI_GROUNDING=on`): o Pesquisador só usa fontes já conhecidas do projeto e registra a limitação; fonte inventada é barrada pela validação.
- **Gemini gratuito:** use chave de projeto do AI Studio **sem faturamento** (o app não consegue verificar). Os limites mudam e valem por projeto Google; confira no AI Studio. O Google pode usar o conteúdo enviado para melhorar produtos no plano gratuito: envie só conteúdo público ou de teste. Há limite local de requisições por minuto (`GEMINI_MAX_RPM`) e de tamanho de entrada/saída. A integração real com o Gemini **ainda não foi exercitada com uma chave**: o teste existe e só roda quando `GEMINI_API_KEY` está definida.
- **YouTube Data API é opcional** e só entrega metadados de vídeos públicos (não baixa vídeo nem transcreve). Tem status próprio em Configurações; a importação manual de link/metadados/arquivo entra com a Central de Conteúdo (fase seguinte).

## Configurar o ambiente real
Copie `.env.example` para `.env.local`. Na Vercel, cadastre as mesmas variáveis como variáveis de ambiente.

| Variável | Tipo | Onde obter |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | públicas | já preenchidas no `.env.example` (projeto `gta-daily-plataforma`) |
| `DATABASE_URL` | **segredo** | Supabase → Project Settings → Database → Connection string (Transaction pooler) |
| `AI_PROVIDER` | opcional | `mock`, `gemini`, `ollama` ou `anthropic` (padrão do servidor; o projeto pode sobrescrever) |
| `GEMINI_API_KEY` | **segredo** | aistudio.google.com → API keys (projeto sem faturamento) |
| `GEMINI_MODEL`, `GEMINI_MAX_RPM`, `GEMINI_GROUNDING` | opcionais | modelo (padrão `gemini-2.5-flash`), limite local por minuto (padrão 5) e busca do Google (`on`) |
| `OLLAMA_MODEL`, `OLLAMA_BASE_URL` | opcionais | modelo local e endereço (padrão `http://localhost:11434`) |
| `ANTHROPIC_API_KEY` | **segredo** (opcional) | console.anthropic.com → API Keys; só usada se escolhida |
| `CLAUDE_MODEL` | opcional | padrão `claude-sonnet-5-5`; `claude-opus-5-5` para mais qualidade (≈2× o custo) |
| `YOUTUBE_API_KEY` | **segredo** (opcional) | Google Cloud → YouTube Data API v3 |
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
src/connectors/    matriz de conectores, adaptador do Claude e ai/ (provedores: mock, gemini, ollama, fábrica e status)
src/orchestrator/  engine (fila, lease, retries, auditoria), pipelines e consultas
src/db/            camada SQL (Postgres/Supabase ou PGlite) e migração local
src/app/           interface (Painel, Execuções, Projetos, Agentes, Configurações), rota do cron e /auth/callback
src/worker/        worker de longa duração
supabase/          migrations e stub de auth para o modo local
tests/             testes automatizados
```
