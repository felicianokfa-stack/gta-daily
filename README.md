# GTA Daily: IA e Agente de Conteúdo

Primeiro projeto real de uma **inteligência de conteúdo**: um funcionário virtual que acompanha um nicho, entende um perfil, identifica oportunidades, produz, acompanha resultados e aprende. Perfil: [@_gtadaily](https://www.instagram.com/_gtadaily/). Escopo: todo o universo GTA (VI, V, Online…).

```
OBSERVAR → ENTENDER → IDENTIFICAR OPORTUNIDADES → PLANEJAR → CRIAR → PUBLICAR → ANALISAR → APRENDER → MELHORAR
DADOS → IA → DECISÃO → AGENTE → AÇÃO → RESULTADO → APRENDIZADO
```

**Comece por aqui:** [`docs/contexto.md`](docs/contexto.md) (documento-base) · [`docs/estado.md`](docs/estado.md) (estado atual) · [`docs/operacao.md`](docs/operacao.md) (como o Agente opera).

## Regras
- Separar sempre **FATO / HIPÓTESE / SINAL / RESULTADO / APRENDIZADO**. Fatos com fonte em [`memoria/fatos.md`](memoria/fatos.md).
- Material: **texto próprio + imagem com origem registrada**. Não usamos vídeo vazado nem corte de streamer sem autorização. Rumor sempre vai rotulado e com fonte.
- Nada é publicado sem aprovação humana.
- Sem senhas de plataformas. Integrações só por OAuth ou API oficial, e tokens nunca entram no repositório.

## Uso de material oficial da Rockstar
- Somente screenshots, artes e trailers **divulgados oficialmente**, com origem registrada em `biblioteca/indice.json`.
- Trechos curtos, **sem o áudio original** (trilhas licenciadas geram bloqueio). O pipeline nunca inclui o áudio da mídia.
- Crédito "Imagens: Rockstar Games" em todo post (`credito_imagem` na pauta).
- Nada de material vazado ou de mapa feito por fã sem autorização.
- Risco residual: uso de divulgação com crédito é prática comum, mas não é licença.

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `pautas/` | Uma pauta JSON por post (`AAAA-MM-DD-NN.json`) |
| `pipeline/` | `render.py` (carrossel + Reel), `caption.py` (legenda), `registro.py` (planilha), `perfil.py` (logo/destaques), `placeholder.py` (mídia de teste) |
| `radar/` | Um arquivo por dia com as oportunidades priorizadas |
| `memoria/` | `fatos.md` (verificados), `dna.md` (DNA do perfil), `aprendizados.md` (sinais e resultados) |
| `templates/fonts/` | Anton e Inter, com licença OFL (os arquivos de licença estão junto) |
| `biblioteca/` | Índice da mídia oficial (os arquivos ficam fora do git); `provisorio/` para teste de layout |
| `registro/` | `registro.xlsx`: posts, métricas (taxas por alcance), tempo, radar, diário |
| `docs/` | Contexto, estado, operação e perfil |

## Uso
```bash
pip install -r requirements.txt
python -m pipeline.render pautas/2026-09-24-01.json --out saida [--data 2026-09-26]
# saida/<id>/carrossel_XX.png, reel.mp4, legenda.txt
# --data define a data de publicação para tokens como {dias_gta6}

python -m pipeline.placeholder   # mídia provisória para teste (nunca publicar)
python -m pipeline.perfil        # opções de foto de perfil e capas de destaques
```

## Formato da pauta
```json
{
  "id": "2026-09-24-01",
  "serie": "faltam-x-dias | gta-online-da-semana (opcional)",
  "tipo": "FATO | RUMOR | CURIOSIDADE | OPINIÃO",
  "origem_ideia": "radar | atemporal | impulso",
  "gancho": "Frase de abertura (aceita {dias_gta6})",
  "subgancho": "Linha de apoio opcional",
  "slides": [{"titulo": "...", "texto": "..."}],
  "cta": "Tela final",
  "fonte": "De onde veio a informação",
  "pergunta": "Pergunta para comentários (legenda)",
  "hashtags": ["#extra"],
  "status": "URGENTE | NOVO | OFICIAL | VAZOU?",
  "destaque": ["palavras da manchete em amarelo"],
  "midia": ["biblioteca/... (uma por tela; repete em ciclo)"],
  "credito_imagem": "Imagens: Rockstar Games"
}
```

O Reel sai sem música, com trilha silenciosa. O áudio é escolhido no app, pela biblioteca do Instagram.
