# Plataforma Multiagente de Conteúdo — Arquitetura (Bloco A)

Base: "Especificação Plataforma Multiagente de Conteúdo Viral GTA VI" v1.0, seção 12.
Este documento cobre as 7 entregas pedidas antes do código. O Bloco B (fundação) está implementado neste repositório.

## 1. Diagnóstico

| Item | Situação encontrada | Decisão |
|---|---|---|
| Repositório `gta-daily` | Só artefatos de um plano anterior descartado (scripts Python, radar, pautas). Nada reaproveitável para orquestração com estado. | Conteúdo antigo removido em commit normal; o histórico fica no git. |
| Instagram GTA DAILY | Conta existente; é o primeiro canal-alvo. | Plataformas do projeto: Reels e Carrossel/Foto (TikTok e Shorts opcionais). |
| Supabase | Projeto novo `gta-daily-plataforma` (ref `lcocstithbpjtsupgsiv`, sa-east-1, plano free) na organização "Agatha". | Migration do Bloco B aplicada; advisor de segurança sem alertas. |
| Vercel | Conector disponível na sessão, sem time listado e sem deploy. | Deploy fica para quando os segredos estiverem configurados. |
| Provedores de IA | Sem `ANTHROPIC_API_KEY`; sem conta paga. | Camada `ModelProvider` com `mock` (demonstração explícita), `gemini`, `ollama` e `anthropic`. Sem provedor escolhido, as etapas param em "Exige ação": o mock nunca é implícito e não há fallback entre provedores. |
| Demais conectores | vidIQ e Canva existem como ferramentas do assistente, não como APIs da plataforma. | Registrados como "precisa validar". |

**Riscos principais**
- Direitos de mídia: um vídeo público não autoriza download ou republicação (bloqueia o D/E sem fonte autorizada).
- Limite de execução serverless: tarefas longas (render, transcrição) exigem worker fora da função da Vercel.
- Alucinação de fontes: mitigada no Bloco B com validação que rejeita URL não recuperada pela busca.
- Custo de modelo: mitigado com reaproveitamento por hash de entrada + versão e limites de tentativas e correções.

## 2. Arquitetura

```mermaid
flowchart TD
  UI["Next.js (App Router)<br/>Painel · Execuções · Projetos · Agentes"] -->|Server Actions| ORQ
  CRON["Vercel Cron<br/>GET /api/worker/tick"] --> ORQ
  WRK["Worker Node<br/>npm run worker"] --> ORQ
  ORQ["Orquestrador<br/>src/orchestrator/engine.ts"] -->|cria / avança| RUNS[(pipeline_runs)]
  ORQ -->|enfileira / reivindica<br/>SKIP LOCKED + lease| TASKS[(agent_tasks)]
  ORQ -->|toda transição| AUD[(audit_events)]
  ORQ --> AG["Agentes de função<br/>Pesquisador · Verificador · …"]
  NICHO["Agentes de nicho<br/>(contexto: GTA VI, …)"] -.briefing.-> AG
  AG --> PROV["ModelProvider<br/>mock · gemini · ollama · anthropic<br/>(escolha por projeto/AI_PROVIDER)"]
  AG --> CON["Adaptadores de conectores<br/>(Buffer, OpusClip, FFmpeg… — próximos blocos)"]
  ORQ --> VAL{"Validação<br/>schema Zod + regras de negócio"}
  VAL -->|ok| NEXT[Próxima etapa ou fim]
  VAL -->|falha| COR["Correção dirigida<br/>(limitada)"] --> TASKS
  VAL -->|limite| ACT["Exige ação"]
```

**Princípios**
- Duas camadas de agentes:
  - **Nicho** só fornece contexto (`src/core/niches.ts`).
  - **Função** é reutilizável entre nichos (`src/agents/`).
  - Um novo nicho não duplica o núcleo.
- Agentes não conhecem fornecedores. Falam com `ModelProvider` (`src/connectors/types.ts`), e cada fornecedor é um adaptador.
- Execução sob demanda: nada fica rodando permanentemente. A fila é consumida por worker ou cron.
- Estado sempre no banco: sair da tela não perde nada, e a UI só lê o estado salvo.
- Nenhum conector simulado. Sem credencial, o estado é `pending_credential` e a etapa vira "Exige ação" com a instrução de correção.

## 3. Contratos entre agentes

Envelope padrão (`src/core/contracts/common.ts`, `agentOutputEnvelope`). É montado **pelo orquestrador**, nunca pelo modelo:

| Campo | Origem |
|---|---|
| `task_id`, `project_id`, `run_id`, `agent_role`, `agent_version` | orquestrador |
| `status` (`completed`) | orquestrador |
| `result` | agente, validado pelo schema do papel |
| `evidence`, `limitations`, `unconfirmed` | regras de negócio do agente |
| `validation { passed, warnings }` | orquestrador |
| `next_step` | definição do pipeline (`fim` na última etapa) |

Schemas por papel (`src/core/contracts/research.ts`):

**Pesquisador `pesquisador@1.0.0`**
- Entrada: `topic`, `goal`, `niche_id`, `correction_notes`.
- Resultado: `summary`, `sources[]` (url, título, publisher, data), `claims_to_verify[]` (alegação + URLs + rótulo inicial), `unknowns[]`.
- Regra: toda fonte precisa ter sido de fato recuperada pela busca, senão é "possível URL inventada" e a saída é rejeitada.

**Verificador `verificador@1.0.0`**
- Entrada: pacote do Pesquisador.
- Resultado: cada alegação com rótulo, `confidence`, `evidence_urls` e notas, além de `contradictions`, `caveats` e `overall`.
- Rótulos possíveis: `fato_confirmado`, `rumor`, `teoria`, `estimativa`, `hipotese` ou `nao_verificado`.
- Regra: `fato_confirmado` exige evidência, e toda URL de evidência precisa ser conhecida.

Os demais 7 papéis estão declarados em `AGENT_ROLES` e aparecem na UI como "previstos". Cada um ganha schema próprio no seu bloco.

## 4. Modelo de dados

Migration: `supabase/migrations/20261023000001_fundacao_pipeline.sql`.

| Tabela | Finalidade | Campos-chave |
|---|---|---|
| `content_projects` | Projeto/nicho do usuário | `owner_id`, `niche`, `audience`, `language`, `platforms[]`, `editorial_rules`, `settings` (limites) |
| `pipeline_runs` | Uma execução de pipeline | `pipeline`, `input`, `status`, `current_step`, `idempotency_key` (único por projeto) |
| `agent_tasks` | Fila e histórico de etapas | `agent_role`, `agent_version`, `input`, `input_hash`, `output`, `status`, `attempts/max_attempts`, `corrections/max_corrections`, `validation`, `error`, `not_before`, `lease_owner/lease_expires_at`, `usage`, `duration_ms`, `reused_from`, `idempotency_key` (único) |
| `audit_events` | Trilha de auditoria | `actor`, `action`, `data`, vínculos com projeto, execução e tarefa |

**Segurança**
- RLS ligado em todas as tabelas.
- O usuário autenticado só **lê** o que é seu. Projetos podem ser criados e editados pelo dono.
- Execuções, tarefas e auditoria só são escritas pelo servidor/worker. Os grants de insert/update/delete foram revogados de `anon` e `authenticated`, então o cliente não consegue forjar estado.

**Cadeia completa (seção 8)**
- Projeto → fonte → análise → oportunidade → briefing → roteiro → corte → versão → revisão → publicação → métricas.
- `source_media`, `media_analysis`, `opportunities`, `clip_candidates`, `clip_versions`, `publication_drafts`, `publication_jobs` e `content_metrics` entram nos blocos C–H.

## 5. Orquestrador

`src/orchestrator/engine.ts`, classe `Orchestrator`.

**Estados de tarefa**
- `queued`, `running`, `waiting_input`, `succeeded`
- `failed_retryable`, `failed_action_required`, `cancelled`

**Estados de execução**
- `queued`, `running`, `waiting_input`, `succeeded`, `failed_action_required`, `cancelled`

**Fila**
- Reivindica com `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, o que permite vários workers sem disputa.
- Elegíveis: `queued`/`failed_retryable` com `not_before <= now()`, ou `running` com lease expirado.
- Por isso, um worker que morreu tem a tarefa retomada automaticamente.

**Lease**
- Toda escrita de resultado exige `lease_owner = eu AND status = 'running'`.
- Um worker antigo que volta depois de perder o lease não sobrescreve nada: o evento é registrado como `task.lease_lost`.

**Idempotência**
- `pipeline_runs (project_id, idempotency_key)`: o formulário gera uma chave, então clique duplo não duplica a execução.
- `agent_tasks.idempotency_key = run_id:etapa`.

**Falhas**
- Erro recuperável do conector:
  - backoff exponencial `min(300 s, 5·2^(n-1))`;
  - até `max_attempts` (padrão 4, configurável por projeto).
- Erro não recuperável (sem credencial, autenticação, recusa): vai direto para `failed_action_required`, com ação sugerida na UI.
- Saída inválida (schema ou regra de negócio):
  - a etapa volta para a fila com `correction_notes` listando os problemas;
  - até `max_corrections` (padrão 2);
  - acima disso, vai para `failed_action_required`.

**Reaproveitamento**
- Uma etapa com o mesmo `agent_role` + `agent_version` + `input_hash` (ignorando notas de correção) e já concluída para o mesmo dono é reaproveitada sem custo de modelo.

**Retomar, cancelar e retentar**
- Cancelar marca a execução e as etapas pendentes. Uma etapa em andamento termina, mas não avança.
- "Tentar de novo" só vale para `failed_action_required`: zera tentativas e correções e reenfileira.

**Auditoria**
- Cada transição grava um `audit_events`, com versão, tentativa, erros, duração e uso de tokens quando houver.

**Execução da fila**
- `npm run worker`: processo contínuo, exige Postgres.
- `GET /api/worker/tick`: Vercel Cron, protegido por `CRON_SECRET`.
- Botão "Processar minha fila agora": processa só as tarefas do próprio usuário.

**Modelo**
- `claude-sonnet-5-5` por padrão (escolha por custo; trocável pela variável `CLAUDE_MODEL`), em duas chamadas:
  1. Pesquisa com `web_search`. As URLs são coletadas dos blocos de resultado da busca.
  2. Estruturação com *structured outputs* (schema Zod).
- Effort: Pesquisador `low`, Verificador `medium`.
- Fallback do lado do servidor ativado (`server-side-fallback-2026-07-01`, `fallbacks: "default"`). No Sonnet 5.5 ele refaz no Sonnet 5 as recusas das categorias `cyber` e `frontier_llm`. As demais recusas viram "Exige ação" com o código `refusal`.

**Reaproveitamento (atualizado no Bloco C)**
- Só reaproveita resultados das últimas 24 h, porque o nicho é de notícias.
- O hash ignora as fontes já conhecidas do projeto, que são só orientação ao agente.

## 6. Matriz de conectores

Estado também visível em **Agentes e conectores** na UI (`src/connectors/registry.ts`).

| Conector | Classificação | Validado neste bloco | Falta |
|---|---|---|---|
| Supabase (Postgres, Auth, RLS) | **Confirmado** | Projeto criado, migration aplicada, advisor de segurança limpo | `DATABASE_URL` (senha do banco) nos segredos do app/worker |
| IA — demonstração (`mock`) | **Disponível** (sem credencial) | Testado ponta a ponta; resultados fictícios marcados como simulados | — |
| IA — Gemini | **Precisa de credencial** | Adaptador e mapeamento de erros testados com API simulada; **sem chamada real ainda** | `GEMINI_API_KEY` (projeto sem faturamento) |
| IA — Ollama | **Precisa de configuração** | Adaptador testado com API simulada; sem busca na web | `OLLAMA_MODEL` |
| IA — Claude (Anthropic) | **Precisa de credencial** (paga) | Adaptador e mapeamento de erros testados; sem chamada real; só usado se escolhido | `ANTHROPIC_API_KEY` |
| YouTube Data API | **Opcional** | Só status; só metadados de vídeos públicos; não bloqueia o restante | `YOUTUBE_API_KEY` |
| Buffer API | **Precisa de credencial + validação documental** | — | Canais suportados, formatos, erros (Bloco G) |
| YouTube Data API | **Precisa de credencial** | — | Credencial Google Cloud; captions só de vídeos autorizados |
| vidIQ | **Precisa de validação documental** | — | Não há API pública confirmada para a plataforma; o acesso atual é só pelo assistente |
| OpusClip API | **Precisa de validação documental** | — | Disponibilidade da API, plano, custo, marca d'água |
| FFmpeg | **Precisa de validação** | — | Worker com FFmpeg instalado (não roda na função serverless) |
| Speech-to-text | **Precisa de validação** | — | Escolha de fornecedor (português, gameplay, custo) |
| Vercel | **Precisa de validação** | — | Projeto, segredos e cron |

## 7. Plano incremental e critérios de aceite

| Bloco | Escopo | Critério objetivo de aceite | Estado |
|---|---|---|---|
| A | Diagnóstico e arquitetura | Este documento; nada sobrescrito sem justificativa | ✅ |
| B | Fundação e orquestração | Tarefa criada, processada, validada, com falha recuperada e retomada, coberta por testes (`npm test`) | ✅ |
| C | Pesquisa/verificação real | Com `ANTHROPIC_API_KEY`: 3 temas GTA VI reais com 100% das fontes rastreáveis (URL recuperada) e incertezas explícitas; tabelas `opportunities` e `source_records`; portão de qualidade antes da estratégia | ✅ código e testes · ⏳ validação real depende da chave |
| D | Central de Conteúdo | Vídeo de teste **autorizado** analisado (transcrição + segmentos); cortes com início, fim e justificativa | 🟡 PR 1 e PR 2 (código e testes): biblioteca de materiais (referência + transcrição com tempos, sem baixar vídeo), Analista de Conteúdo, cortes candidatos e seleção; produção de um corte (Estrategista, Roteirista, Produtor Audiovisual, Distribuidor, Revisor), portão do rascunho e aprovação humana. PR 3 (fechamento): passo a passo na tela, processamento automático ao analisar/produzir, só plataformas de vídeo e regras de qualidade extras; validação real com Gemini feita em 31/10/2026 até a aprovação de um rascunho. Sem STT/FFmpeg/upload/publicação: a transcrição é informada pelo usuário e nada é renderizado nem publicado |
| E | Produção e renderização | Arquivo 9:16 válido, legendas sincronizadas, reproduzível (mesma entrada → mesmo arquivo) | — |
| F | Adaptação por plataforma | Versões editáveis Reels, TikTok e Shorts (e carrossel) vinculadas ao corte e à fonte | — |
| G | Aprovação e Buffer | Aprovação humana obrigatória; publicação de teste real confirmada pelo provedor, ou pendência documentada | — |
| H | Analytics e aprendizado | Métricas com fonte e definição; recomendações ligadas às hipóteses | — |
| I | Expansão de nichos | Novo nicho (ex.: Tendências) configurado sem alterar `src/agents` nem o orquestrador | — |

### Testes do Bloco B (`tests/`)

O banco dos testes é PGlite, com as mesmas migrations e roles do Supabase.

- **Fluxo ponta a ponta:** Pesquisador → Verificador → execução concluída, com a sequência exata da auditoria.
- **Correção e validação:**
  - saída inválida → correção dirigida → sucesso;
  - limite de correções → "Exige ação";
  - `fato_confirmado` sem evidência é rejeitado;
  - URL inventada é rejeitada.
- **Falhas de conector:**
  - sem credencial → "Exige ação" → "Tentar de novo";
  - erro temporário → backoff.
- **Lease:**
  - worker "morre" → lease expira → outro worker retoma;
  - o worker antigo não sobrescreve.
- **Persistência:** o estado sobrevive à troca de instância do orquestrador.
- **Idempotência, reaproveitamento e cancelamento:** idempotência de execução, reaproveitamento por hash, cancelamento antes e durante a execução.
- **Isolamento:** entre usuários, no código e via RLS (`set role authenticated`). Inserts forjados e acesso `anon` são negados.
- **Contratos:** dados incompletos são rejeitados e o hash é estável.

## 8. Bloco C — Pesquisa e verificação com fontes e oportunidades

**Contratos (versões 1.1.0)**
- Pesquisador: recebe `known_sources` (até 20 fontes já registradas no projeto) e devolve `relevance { score 0–100, reason }`. É interesse editorial estimado, não probabilidade de viralizar.
- Verificador: devolve `additional_sources`, as fontes novas que encontrou. Toda URL de evidência precisa estar entre as fontes registradas, e toda fonte adicional precisa ter sido recuperada na busca.

**Dados** (`supabase/migrations/20261024000001_fontes_oportunidades.sql`)
- `source_records`:
  - uma linha por projeto + URL, com tipo `primaria` (domínio oficial do nicho) ou `secundaria`;
  - campos `first_seen_run`, `last_seen_run` e `times_seen`.
- `opportunities`:
  - uma por execução, com tema, resumo, estado de verificação, relevância, prioridade sugerida, alegações, contradições, ressalvas, URLs e resultado do portão;
  - status `nova`, `pronta_para_estrategia` ou `descartada`.
- `agent_tasks.cost_usd`: custo estimado acumulado por tarefa.
- Segurança: RLS somente leitura para o dono; escrita só pelo servidor.

**Portão de qualidade** (`src/orchestrator/quality-gate.ts`)
1. **Rastreabilidade:** toda evidência aponta para uma fonte registrada.
2. **Evidência suficiente:** pelo menos um fato confirmado por fonte primária (`primary_domains` do nicho: rockstargames.com, take2games.com, playstation.com, xbox.com) ou por dois domínios independentes.
3. **Contradições explicadas:** se houver contradição, precisa haver ressalva.

O resultado:
- Passou: a oportunidade fica "Pronta para estratégia".
- Não passou: fica "Precisa de mais verificação", com os motivos visíveis.
- Em qualquer caso, o usuário pode liberar, descartar ou reabrir. A decisão é auditada (`opportunity.decided`).

**Materialização**
- Acontece na mesma transação que conclui a execução e é idempotente.
- Se falhar, a execução vai para "Exige ação" (`advance_failed`) em vez de ficar presa.

**Custo e orçamento**
- Custo estimado a preço de lista (`src/connectors/pricing.ts`):

  | Item | Preço |
  |---|---|
  | Sonnet 5.5, entrada / saída | US$ 2 / 10 por milhão de tokens |
  | Opus 5.5, entrada / saída | US$ 4 / 20 por milhão de tokens |
  | Leitura de cache | US$ 0,20 por milhão de tokens |
  | Escrita de cache | 1,25× o preço de entrada |
  | Busca na web | US$ 0,01 por busca |

- Cada projeto tem `monthly_budget_usd`. Ao atingir o gasto estimado do mês (UTC), a etapa seguinte para em "Exige ação" (`budget_exceeded`) **antes** de chamar o modelo.
- Limitação: em fallback no servidor, só a tentativa que gerou a resposta entra na conta. Uma etapa que falha com erro do conector não registra custo parcial.


## 9. Central de Conteúdo — PR 1 (base e análise)
- **Tabelas** (`20261031000001_central_conteudo_base.sql`, RLS: dono lê, escrita só pelo servidor): `media_items` (referência/link opcional, duração, metadados, `transcript` jsonb com segmentos `{id, start_s, end_s, text}`, `usage_rights` com a declaração de autorização, `is_sample`) e `clip_candidates` (tempos, justificativa, pontuação 0–100 + motivo, riscos, `status` sugerido/selecionado/descartado, `simulated`). A coluna se chama `usage_rights` porque `authorization` é palavra reservada do Postgres.
- **Contratos** (`src/core/contracts/content.ts`): entrada com a transcrição e resultado do Analista de Conteúdo (até 8 cortes). Regras de `validate`: tempos dentro da transcrição e coerentes com os segmentos citados (tolerância 1 s), duração do corte entre 5 e 120 s, segmentos existentes, linguagem de promessa proibida na pontuação e explicação obrigatória quando não há cortes.
- **Pipeline** `analise_midia` = `[analista_conteudo]`; a entrada vem de `PipelineDefinition.buildRunInput` (que também passou a montar a entrada da pesquisa) e `onSucceeded` grava os candidatos marcando `simulated` quando o provedor é de demonstração.
- **Direitos:** o material só é analisado com a autorização declarada (obrigatória); o link é só referência e nada é baixado.
- **Demonstração:** o `mock` agrupa trechos consecutivos da própria transcrição e marca tudo como `[SIMULADO]`.

## 10. Central de Conteúdo — PR 2 (produção e aprovação)
- **Tabela** `clip_drafts` (`20261031000002_clip_drafts.sql`, RLS só-leitura para o dono): `brief`, `script`, `production_plan`, `platform_versions`, `review`, `gate` (jsonb), `status` (`em_revisao`|`aprovado`|`rejeitado`), decisão (`decided_by/at`, `decision_note`) e `simulated`. Uma por execução (`run_id` único).
- **Contratos** (`src/core/contracts/content.ts`) — contexto comum `ClipContext` (corte + trechos da transcrição + plataformas do projeto) e um resultado por papel:
  - **Estrategista** → `StrategyBrief`: mensagens com `label` de `EvidenceLabel` **sem `fato_confirmado`** (a transcrição não confirma fatos), cada uma citando segmentos.
  - **Roteirista** → `ScriptResult`: batidas `{t_start, t_end, voiceover, on_screen_text, segment_id, quote}`; `quote` precisa aparecer **literalmente** no segmento citado.
  - **Produtor Audiovisual** → `ProductionPlan`: `format = "9:16"` e `rendered = false` (literais): é um plano, nenhum arquivo é gerado; legendas de até 2 linhas × 42 caracteres e ≥ 0,8 s.
  - **Distribuidor** → `Distribution`: uma versão por plataforma do projeto, dentro de `PLATFORM_LIMITS` (limites **do app**, não garantia oficial). Não publica.
  - **Revisor de Qualidade** → `ReviewResult` (veredito + checagens + problemas).
- **Regras compartilhadas** (`src/core/content-rules.ts`): linha do tempo, citação literal, hashtags, cobertura de plataformas, linguagem de promessa e vazamento como oficial; usadas pelas validações dos agentes e pelo portão.
- **Pipeline** `producao_corte` (5 etapas); `buildRunInput` exige corte **selecionado**, material autorizado, trechos do corte e plataformas no projeto. `onSucceeded` (`materialize-draft.ts`) roda o **portão determinístico** (`draft-gate.ts`: tempos, citações, rótulos, plataformas, plano não renderizado, veredito do revisor) e grava o rascunho em `em_revisao`.
- **Decisão humana** (`decideDraft`): rejeitar exige nota; aprovar um rascunho reprovado pelo portão exige confirmação ("aprovar mesmo assim"), registrada como `forced`; eventos `draft.decided` na auditoria. Aprovar não publica nada.

## 11. Central de Conteúdo — PR 3 (fechamento)
- **Processamento automático:** `analyzeMediaAction` e `produceClipAction` criam a execução e chamam `runAndSettle` (`src/orchestrator/auto-run.ts`), que faz `drain(10, { ownerId })` na mesma requisição (`maxDuration = 300` na página do material) e devolve status e rascunho. Sucesso → `/biblioteca/{id}` (análise) ou `/cortes/{draft}` (produção); falha → `/execucoes/{run}`. Falhas de etapa não lançam: o estado fica na execução. Com o worker/cron continua valendo o mesmo motor.
- **Plataformas:** `VIDEO_PLATFORMS` (Reels, TikTok, Shorts). `clipRunInput` filtra o projeto e recusa se não houver nenhuma de vídeo.
- **Validações novas:** `timing_note` com tempo em segundos é erro (Distribuidor); notas de áudio com trilha/música/efeito geram aviso (Produtor Audiovisual); `ungroundedHashtags` gera aviso, nunca bloqueia; `createSampleMedia` recusa um segundo exemplo no projeto.
- **Interface:** componente `Stepper` (5 passos com estados feito/atual/pendente) na página do material, cartão “Como funciona” na Biblioteca e links para o resultado na página da execução.
