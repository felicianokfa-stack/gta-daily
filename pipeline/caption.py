"""Monta a legenda do post a partir da pauta."""
from __future__ import annotations

BASE_HASHTAGS = ["#gta", "#gta6", "#gtavi", "#rockstargames", "#gtadaily"]

AVISO = {
    "RUMOR": "⚠️ RUMOR: ainda não confirmado pela Rockstar. Trate como especulação.",
}


def build_caption(pauta: dict) -> str:
    parts = [pauta.get("legenda_abertura") or pauta["gancho"]]
    if pauta.get("legenda_corpo"):
        parts.append(pauta["legenda_corpo"])
    if pauta["tipo"].upper() in AVISO:
        parts.append(AVISO[pauta["tipo"].upper()])
    if pauta.get("fonte"):
        parts.append(f"Fonte: {pauta['fonte']}")
    if pauta.get("credito_imagem"):
        parts.append(pauta["credito_imagem"])
    if pauta.get("pergunta"):
        parts.append(f"💬 {pauta['pergunta']}")
    parts.append(pauta.get("cta_legenda", "Segue @_gtadaily pra acompanhar tudo de GTA todo dia."))
    tags = list(dict.fromkeys(BASE_HASHTAGS + pauta.get("hashtags", [])))[:8]
    parts.append(" ".join(tags))
    return "\n\n".join(parts) + "\n"
