# GTA Daily: laboratório

Laboratório de validação de uma metodologia de conteúdo usando o Instagram [@_gtadaily](https://www.instagram.com/_gtadaily/):

RADAR → OPORTUNIDADE → IDEIA → PRODUÇÃO → PUBLICAÇÃO → MÉTRICAS → APRENDIZADO

O GTA Daily não é o produto. É onde testamos se a metodologia funciona, antes de decidir se existe um SaaS.

## Regras do laboratório
- Separar sempre **FATO / HIPÓTESE / TESTE / RESULTADO / APRENDIZADO / PRÓXIMA AÇÃO**.
- Material: **texto próprio + imagem com origem registrada**. Não usamos vídeo vazado nem corte de streamer sem autorização. Rumor sempre vai rotulado e com fonte.
- Nada é publicado sem aprovação humana.
- Sem senhas de plataformas. Integrações só por OAuth ou API oficial, e tokens nunca entram no repositório.

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `pautas/` | Uma pauta JSON por post (`AAAA-MM-DD-NN.json`) |
| `pipeline/` | `render.py` (carrossel PNG 1080x1350 + Reel MP4 1080x1920) e `caption.py` (legenda) |
| `templates/fonts/` | Anton e Inter, com licença OFL (os arquivos de licença estão junto) |
| `registro/` | Planilha de posts, métricas, tempo de produção, radar e diário |
| `docs/blocos/` | Documentos de cada bloco do projeto |

## Uso
```bash
pip install -r requirements.txt
python -m pipeline.render pautas/2026-09-24-01.json --out saida
# saida/<id>/carrossel_XX.png, reel.mp4, legenda.txt
```

## Formato da pauta
```json
{
  "id": "2026-09-24-01",
  "tipo": "FATO | RUMOR | CURIOSIDADE | OPINIÃO",
  "origem_ideia": "radar | atemporal | impulso",
  "gancho": "Frase de abertura (capa / primeiros segundos)",
  "subgancho": "Linha de apoio opcional",
  "slides": [{"titulo": "...", "texto": "..."}],
  "cta": "Tela final",
  "fonte": "De onde veio a informação",
  "pergunta": "Pergunta para comentários (legenda)",
  "hashtags": ["#extra"],
  "imagem_fundo": "caminho relativo à pauta ou null"
}
```

O Reel sai sem música, com trilha silenciosa. O áudio é escolhido no app, pela biblioteca do Instagram.
