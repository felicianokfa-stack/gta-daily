# Estado do projeto (atualizado em 25/09/2026)

Documento vivo. Substitui o antigo "Bloco 1: Plano de validação". Os blocos continuam existindo como organização interna, mas não travam o andamento.

## 1. Onde estamos
| Área | Estado |
|---|---|
| Perfil @_gtadaily | ✅ FATO (vidIQ): 0 seguidores, 2 seguindo, 0 posts, sem foto nem bio. Conta pessoal. Proposta pronta em [`perfil.md`](perfil.md), **aguarda aplicação** |
| Produção (Content Studio v0) | ✅ Pipeline pauta → carrossel + Reel + legenda (estilo "portal de notícias gamer"), cerca de 1 min por pauta |
| Mídia | ⚠️ Só provisória (gerada por código). Mídia oficial bloqueada pela rede |
| Radar (Intelligence v0) | ✅ Primeira execução em [`radar/2026-09-25.md`](../radar/2026-09-25.md). Rotina diária agendada para 08:00 (Brasília) |
| Memória (Memory v0) | ✅ [`memoria/`](../memoria/): fatos, DNA (hipóteses), aprendizados |
| Registro (Analytics v0) | ✅ `registro/registro.xlsx`, ainda sem dados |
| Publicação (Publishing) | ⏳ Reels pelo vidIQ depois de o Instagram ser conectado; carrossel manual |
| Métricas | ❌ Sem Insights até a conta virar profissional |

## 2. O que está definido
- Material: texto próprio + mídia oficial com crédito. Sem vazamento e sem corte sem autorização. Vídeo entra sem o áudio original.
- Fase atual só no Instagram. Conteúdo em português, sem rosto e sem voz.
- Estilo visual v2: mídia em tela cheia, manchete com destaque amarelo, selos de status e de tipo, logo GD.
- Nada é publicado sem OK humano ([`operacao.md`](operacao.md)).
- Regras de evidência: FATO / HIPÓTESE / SINAL / RESULTADO / APRENDIZADO ([`contexto.md`](contexto.md)).

## 3. O que falta desenvolver
| Item | Depende de |
|---|---|
| Aplicar perfil (profissional, nome, bio, foto) | Dono |
| Mídia oficial (screenshots, trailers, Extended Look) | Liberar rede para rockstargames.com e/ou o dono enviar os arquivos |
| Publicação de Reels com aprovação | Conectar Instagram ao vidIQ |
| Coleta de métricas | Conta profissional + conexão |
| Publicação de carrossel e Insights pela API oficial da Meta | App na Meta + OAuth (avaliar depois de validar o valor) |
| Reaproveitamento (1 fonte → Story, Short, TikTok) | Decidir quando abrir outras plataformas |
| Benchmark de concorrentes (outliers do vidIQ) | OK para gastar créditos |

## 4. Hipóteses em teste
**Conteúdo**
| # | Hipótese | Métrica |
|---|---|---|
| C1 | Assunto atual (radar) supera assunto atemporal | compartilhamentos/alcance, seguidores/alcance |
| C2 | Antes do lançamento, GTA VI supera GTA V/Online em alcance, mas GTA Online supera em salvamentos (conteúdo de serviço) | alcance; salvamentos/alcance |
| C3 | Gancho explícito no primeiro 1–2 s supera abertura "cinematográfica" | tempo médio assistido, taxa de pulo |
| C4 | Serviço e curiosidade geram salvamento; humor e polêmica geram compartilhamento | salvamentos vs compartilhamentos |
| C5 | Reel ≤ 15 s retém proporcionalmente mais que Reel ≥ 30 s | % assistido |
| C6 | Séries recorrentes ("Faltam X dias", "GTA Online da semana") geram retorno e seguidores | seguidores/alcance ao longo da série |
| C7 | Em português, a concorrência de notícias de GTA é menor que em inglês | benchmark (vidIQ) |

**Método e produto**
| # | Hipótese | Medida |
|---|---|---|
| M1 | O radar automático encontra ≥ 3 oportunidades aproveitáveis por dia | taxa de pautas aprovadas / oportunidades |
| M2 | Com o pipeline, o gargalo passa a ser verificação e aprovação, não edição | tempo por etapa |
| M3 | O Agente proativo reduz o tempo do dono para ≤ 10 min por post | tempo de revisão e publicação |
| M4 | Pautas priorizadas pelo radar performam melhor que as de impulso | comparação por `origem_ideia` |
| P1 | O dono (sem tempo e sem material próprio) representa o público-alvo do futuro SaaS | entrevistas / segundo nicho |

## 5. Critérios de evidência
- **< 5 posts por variante:** no máximo **SINAL**. "Ainda não temos dados suficientes para concluir."
- **≥ 5 por variante, mediana da taxa ≥ 1,5x e maioria na mesma direção:** SINAL forte.
- **Repetido em um segundo período:** **APRENDIZADO**. Entra em [`memoria/dna.md`](../memoria/dna.md).
- A métrica principal é definida antes do teste. Semanas com evento forte (trailer, lançamento) são analisadas à parte. Conta nova: as primeiras 2 semanas são linha de base.

## 6. Oportunidades que ainda não tínhamos considerado
1. **Série semanal "GTA Online da semana"** (toda quinta). Pauta previsível, de serviço, independente do GTA VI, e sustenta o perfil depois do lançamento. SINAL: vários sites especializados cobrem toda semana.
2. **Série diária "Faltam X dias"** até 19/11. Um formato fixo permite testar **uma variável por vez** (gancho, horário, duração). É o experimento controlado mais limpo que temos.
3. **Trial Reels:** o vidIQ publica como "Trial", o que mostraria o Reel primeiro para quem não segue. Serve para testar ganchos com 0 seguidores. HIPÓTESE: falta confirmar se a conta tem acesso.
4. **Conteúdo de serviço para o Brasil:** horário de liberação no Brasil, preço em reais, edições, tamanho do download. Pouca gente responde isso em português (HIPÓTESE C7).
5. **Nostalgia Vice City 2002 → 2026:** camisa do Tommy Vercetti no bônus de pré-venda (a verificar). Ponte entre gerações de jogadores.
6. **Stories com enquete:** sinal barato do que o público quer, antes de produzir.
7. **Janela pós-lançamento:** depois de 19/11, o assunto muda para guias, segredos e comparações. O radar precisa se preparar para essa virada.

## 7. Próximas ações do Agente (sem depender do dono)
- Radar diário às 08:00 com pauta e prévia.
- Verificar o Vintage Vice City Pack e o horário de lançamento no Brasil.
- Manter `memoria/fatos.md` atualizado.
