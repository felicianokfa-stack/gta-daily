# Contexto do projeto: GTA Daily, IA e Agente de Conteúdo

Este é o documento-base do projeto. Toda conversa e toda rotina do Agente partem daqui.

## 1. Visão
Desenvolver uma **inteligência de conteúdo** que, no futuro, possa virar um SaaS. Ela não é só um editor de vídeo, um gerador de ideias, um gerador de roteiro ou um calendário. É um **funcionário virtual de conteúdo**: acompanha um nicho, entende um perfil, identifica oportunidades, ajuda a produzir, acompanha resultados e aprende de forma contínua.

**Ciclo principal**
```
OBSERVAR → ENTENDER → IDENTIFICAR OPORTUNIDADES → PLANEJAR → CRIAR → PUBLICAR → ANALISAR → APRENDER → MELHORAR
```

O **@_gtadaily** é o primeiro projeto real onde essa inteligência é colocada em prática.

## 2. GTA Daily: escopo
O perfil não se limita ao GTA VI. O universo inclui GTA VI, GTA V, GTA Online, personagens, cenas, curiosidades, teorias, notícias, trailers, comparações, memes, tendências, veículos, mapas, detalhes, comunidade e acontecimentos relevantes.

O perfil precisa ter identidade própria e, com o tempo, um **DNA**: estilo, linguagem, estética, ritmo, duração, ganchos, temas, formatos, CTAs, frequência, horários e comportamento do público. O DNA fica em [`memoria/dna.md`](../memoria/dna.md) e orienta as próximas decisões.

## 3. Radar de conteúdo
O radar acompanha sites especializados, canais oficiais, notícias, YouTube, redes sociais, comunidades públicas, fóruns, criadores e tendências. O objetivo é transformar informação em **oportunidade de conteúdo**. Para cada oportunidade, quando houver dados:

**o que aconteceu · por que é relevante · momento · interesse · concorrência · abordagem · formato · gancho · prioridade**

Os registros ficam em [`radar/`](../radar/), um arquivo por dia.

## 4. IA e Agente
| | IA (inteligência) | AGENTE (execução) |
|---|---|---|
| Papel | Pensar | Agir |
| Faz | pesquisar, interpretar, raciocinar, analisar, comparar, identificar padrões, criar, planejar, analisar resultados, aprender com contexto | monitorar, pesquisar, organizar, preparar conteúdo, executar tarefas, acompanhar métricas, iniciar fluxos, atualizar informações, agir de forma proativa |
| Limite | Não trata hipótese como fato | Só age dentro das ferramentas, permissões e limites de segurança |

**Arquitetura**
```
DADOS → IA → DECISÃO → AGENTE → AÇÃO → RESULTADO → APRENDIZADO
  ↑                                                      │
  └──────────────────── memória ─────────────────────────┘
```

**Proatividade:** o Agente não espera a pergunta. Se encontra algo relevante, traz. Se vê uma oportunidade, aponta. Se encontra um problema, propõe solução. Se a tarefa é de baixo risco, executa. Ações externas relevantes ou irreversíveis pedem confirmação. A matriz de autonomia está em [`docs/operacao.md`](operacao.md).

## 5. Conteúdo
- **Vídeos:** upload, transcrição, melhores momentos, cortes, versões, legendas, 9:16, títulos, descrições, CTA.
- **Carrosséis:** estrutura, textos, slides, identidade, CTA.
- **Roteiros:** Reels, Shorts, TikTok, vídeo longo, notícia, curiosidade, comparação, storytelling.
- **Reaproveitamento:** `1 FONTE → REEL + SHORT + STORY + CARROSSEL + POST + ROTEIRO + …`

## 6. Calendário e distribuição
O calendário considera histórico, desempenho, dia, horário, formato, tema, frequência, sazonalidade, tendências e acontecimentos. Não existe "melhor horário universal". O que buscamos é o melhor contexto para **este** perfil, **neste** momento.

Integrações (Instagram, YouTube, TikTok…) só por mecanismos oficiais, APIs e permissões adequadas. Cada plataforma é um conector independente.

## 7. Métricas e memória
Acompanhar, quando houver: visualizações, alcance, retenção, curtidas, comentários, compartilhamentos, salvamentos, visitas ao perfil, seguidores, conversões. Não olhar só views.

Registrar também o **tempo** de pesquisa, ideia, roteiro, busca de material, edição, legenda e publicação, para descobrir onde a automação gera valor de verdade.

A memória conecta:
```
PERFIL + NICHO + CONTEÚDO + HISTÓRICO + RESULTADOS + APRENDIZADOS
```
Onde fica cada parte: [`memoria/`](../memoria/) (DNA, fatos, aprendizados), [`registro/`](../registro/) (dados por post) e [`radar/`](../radar/) (oportunidades).

## 8. Regras de evidência
| Rótulo | Significado |
|---|---|
| **FATO** | Informação verificada, com fonte e data de verificação |
| **HIPÓTESE** | Possibilidade ainda não comprovada |
| **SINAL** | Indício relevante, ainda insuficiente para concluir |
| **RESULTADO** | O que aconteceu (dado observado) |
| **APRENDIZADO** | Conclusão sustentada pelos dados |

- Nunca inventar informação nem tratar hipótese como certeza. Nunca prometer viralização.
- Antes de concluir, considerar tamanho da amostra, contexto e recência.
- No conteúdo publicado: **rumor sempre vai rotulado como RUMOR**, com fonte.

## 9. Agente GTA
É a evolução natural: conhecimento do universo GTA + monitoramento + memória + radar + inteligência editorial + DNA do GTA Daily + produção + análise + aprendizado. Depois, o mesmo conceito vai para outros nichos, para separar o que é **específico de GTA** do que é **generalizável**.

## 10. Futuro SaaS (direção, não decisão)
**Módulos:** INTELLIGENCE (radar, pesquisa, oportunidades) · CONTENT STUDIO · PUBLISHING · ANALYTICS · MEMORY · AGENTS · CONNECTORS.

**Evolução:** CREATOR → INTELLIGENT → AUTOPILOT (criar → decidir → operar).

## 11. Segurança
Autenticação, autorização, OAuth, proteção de tokens, isolamento de dados, permissões mínimas, logs, auditoria, backups, recuperação, proteção de arquivos, validação e revogação de acesso. Não guardar senha de rede social quando houver OAuth. Ações destrutivas, financeiras ou externas de alto impacto têm controle apropriado.

## 12. Direitos autorais
Não criamos mecanismos para burlar Content ID, sistemas de detecção, proteções ou direitos autorais. Prioridade para conteúdo próprio, autorizado, licenciado e recursos oficiais. As regras práticas de uso do material da Rockstar estão no [README](../README.md).

## 13. Forma de trabalho
- O trabalho é dinâmico e proativo, sem fluxo engessado. Os blocos são organização interna, não portões.
- Se uma descoberta muda uma decisão anterior, o raciocínio é atualizado e registrado.
- Não há concordância automática: se existe abordagem melhor, ela é proposta.
- Decisões que dependem do dono do projeto, ou ações externas importantes, vão para ele.
- Informação atual é pesquisada em fontes confiáveis, separando o que foi encontrado do que é interpretação.

**Comportamento esperado:** `PENSAR → PESQUISAR → ANALISAR → AGIR → APRENDER → EVOLUIR`

## 14. Objetivo final
```
IA QUE RESPONDE → IA QUE ENTENDE → IA QUE IDENTIFICA OPORTUNIDADES
→ AGENTE QUE EXECUTA → AGENTE QUE OPERA CONTINUAMENTE (com supervisão humana adequada)
```
A inteligência precisa entender **o que está acontecendo + o que está funcionando + quem é o perfil + o que o público está respondendo + o que deve ser feito agora**, e transformar isso em ação.
