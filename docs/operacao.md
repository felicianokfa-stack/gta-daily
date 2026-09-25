# Operação do Agente

Como o Agente opera o GTA Daily no dia a dia. As ferramentas disponíveis hoje estão na seção 5.

## 1. Rotinas
| Rotina | Quando | O que faz | Saída |
|---|---|---|---|
| **Radar diário** | Todo dia, 08:00 (horário de Brasília) | Pesquisa o universo GTA (VI, V, Online, comunidade), classifica oportunidades, atualiza os fatos, renderiza a melhor pauta | `radar/AAAA-MM-DD.md`, pauta em `pautas/`, prévia para aprovação |
| **GTA Online semanal** | Quinta-feira (dia da atualização semanal) | Resume bônus, descontos e itens grátis da semana | Pauta da série semanal |
| **Métricas** | 24h, 72h e 7d após cada post | Coleta os Insights (quando a conta for profissional e estiver conectada) | Aba Métricas do `registro/registro.xlsx` |
| **Revisão semanal** | Domingo | Compara resultados, atualiza SINAIS e APRENDIZADOS e propõe os testes da semana | `memoria/aprendizados.md`, ajuste em `memoria/dna.md` |

## 2. Matriz de autonomia
| Nível | Ações | Regra |
|---|---|---|
| **Executa sozinho** (baixo risco, reversível, interno) | Pesquisar; analisar; escrever o radar; criar pautas; renderizar prévias; atualizar memória, registro e documentos; commitar no repositório `gta-daily` | Faz e informa no resumo |
| **Pede OK antes** (externo ou relevante) | Publicar qualquer conteúdo; alterar o perfil; responder publicamente; gastar créditos de forma relevante (por exemplo, o vidIQ); conectar serviços; agendar ou remover rotinas novas | Envia prévia + recomendação e espera "OK" |
| **Nunca faz** | Pedir ou guardar senha; burlar Content ID ou outra proteção; publicar material vazado ou corte sem autorização; apresentar rumor como fato; prometer resultado | — |

## 3. Formato da mensagem proativa
```
🟢/🟡/🔴 [prioridade] ASSUNTO
O que aconteceu: … (FATO/RUMOR, fonte, data)
Por que importa: …
Oportunidade: formato + gancho + momento
Já fiz: … (pauta, prévia)
Preciso de você: … (ou "nada")
```

## 4. Critérios de prioridade do radar
Pontuação de 1 a 5 em cada critério:
- **Relevância para o público** do perfil.
- **Momento:** começando = 5, crescendo = 4, no pico = 3, saturando = 1.
- **Diferenciação possível:** existe um ângulo que outros não usaram?
- **Viabilidade:** temos material e fonte segura?
- **Valor de aprendizado:** o post testa uma hipótese do [`docs/estado.md`](estado.md)?

Prioridade = média. Uma oportunidade de nota ≥ 4 vira pauta no mesmo dia.

## 5. Ferramentas e estado das permissões (25/09/2026)
| Ferramenta | Uso | Estado |
|---|---|---|
| WebSearch | Radar e verificação | ✅ ativo (alguns sites bloqueados para leitura direta) |
| vidIQ | Perfil público do IG, tendências, outliers, **publicação de Reels** | ✅ conectado · ⏳ Instagram ainda não conectado ao vidIQ |
| Canva | Peças especiais e imagens | ✅ conectado |
| GitHub `gta-daily` | Memória, código, registro | ✅ leitura e escrita |
| Supabase | Armazenamento de mídia (futuro) | ✅ conectado, sem uso ainda |
| Rede → rockstargames.com | Mídia oficial | ❌ bloqueado (liberação depende do dono) |
| API oficial do Instagram (Meta) | Publicação de carrossel e Insights diretos | ❌ não configurado |
