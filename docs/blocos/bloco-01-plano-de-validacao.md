# BLOCO 1: Plano de validação GTA Daily

Status: **aprovado**, com Sprint 0 em andamento (24/09/2026).

## Objetivo
Montar a estrutura mínima para que cada post vire dado comparável e rodar os primeiros ciclos para responder:
1. **Conteúdo:** quais assuntos, ângulos, ganchos e formatos geram melhores sinais (compartilhamentos, salvamentos e seguidores por alcance)?
2. **Método:** o ciclo radar → decisão → produção → medição é sustentável? Quanto custa cada etapa?

## O que sabemos (fatos)
- 24/09/2026: @_gtadaily tem 0 seguidores, segue 2 contas, 0 posts, sem foto e sem bio (verificado via vidIQ). É conta pessoal, sem Insights.
- Existe o perfil @gtadailys ("Daily GTA Videos"), com cerca de 9,8 mil seguidores segundo resultado de busca, no mesmo nicho. Há risco de confusão de nome.
- O GTA VI tem lançamento divulgado para 19/11/2026 (PS5/Xbox Series), segundo fontes secundárias (PCGamesN, Beebom). Não confirmei na fonte oficial.
- Restrições do operador: sem videogame, sem tempo para editar, sem rosto e sem voz. Conteúdo em português.

## Decisões
- Material: texto + imagem oficial ou de origem registrada. Nada de vazamento hospedado nem corte sem autorização.
- Produção automatizada por `pipeline/render.py`, com aprovação humana antes de publicar.
- Fase 1 só no Instagram.
- Publicação automática de Reels via vidIQ (integração oficial com o Instagram) depois de a conta virar profissional e ser conectada. Carrossel continua manual por enquanto.

## Hipóteses
**Conteúdo**
| # | Hipótese | Métrica |
|---|---|---|
| C1 | Assunto atual (radar) supera atemporal | compartilhamentos/alcance, seguidores/alcance |
| C2 | Antes do lançamento, GTA VI supera GTA V/Online | alcance, seguidores/alcance |
| C3 | Gancho explícito no primeiro 1–2 s supera abertura "cinematográfica" | tempo médio assistido, taxa de pulo |
| C4 | Curiosidade gera salvamento; humor gera compartilhamento | salvamentos vs compartilhamentos por alcance |
| C5 | Reel ≤15 s retém proporcionalmente mais que ≥30 s | % assistido |

**Método**
| # | Hipótese | Medida |
|---|---|---|
| M1 | Radar de no máximo 30 min/dia gera pelo menos 3 oportunidades aproveitáveis | log do radar |
| M2 | Com o pipeline, o gargalo deixa de ser editar e passa a ser pesquisar e aprovar | tempo por etapa |
| M3 | Registrar dados custa no máximo 5 min por post | tempo de registro |
| M4 | Pautas priorizadas pelo radar performam melhor que as de impulso | comparação por `origem_ideia` |
| P1 | O operador (sem tempo e sem material próprio) representa o público-alvo do futuro produto | a validar no Bloco 10/11 |

## Critérios de aprendizado válido
- **Menos de 5 posts por variante:** "sinal fraco". Ainda não temos dados suficientes para concluir.
- **Pelo menos 5 por variante e mediana da taxa pelo menos 1,5x**, com a maioria na mesma direção: "sinal".
- **Sinal repetido em um segundo período:** "aprendizado", que entra no DNA do perfil.
- A métrica principal é definida **antes** de cada teste. Semanas com evento externo forte são analisadas separadas.
- Conta nova começa do zero de alcance: as primeiras 2 semanas servem de linha de base, não de conclusão.

## Sequência
1. **Sprint 0:** conta profissional, repositório, pipeline, planilha de registro, rotina do radar.
2. **Sprint 1** (cerca de 2 semanas, 10–14 posts): assunto do radar vs atemporal, com formato fixo.
3. **Sprint 2:** gancho e edição.
4. **Semana do lançamento (≈19/11):** teste de velocidade do radar, analisado como período à parte.
5. **Depois do lançamento:** novo diagnóstico.

## Registro
Planilha em `registro/`, com as abas Posts, Métricas (24h/72h/7d), Tempo, Radar (incluindo pautas descartadas) e Diário.
