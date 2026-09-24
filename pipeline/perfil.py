"""Gera as peças do perfil: opções de foto (logo) e capas de destaques.

Uso:
    python -m pipeline.perfil --out saida/perfil
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

from pipeline.render import ORANGE, PINK, WHITE, YELLOW, f_body, f_display

SIZE = 1080


def _gradient(size, c0, c1, diagonal=True) -> Image.Image:
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for i in range(size * 2 if diagonal else size):
        t = i / (size * 2 if diagonal else size)
        c = tuple(int(c0[k] * (1 - t) + c1[k] * t) for k in range(3))
        if diagonal:
            d.line([(i, 0), (0, i)], fill=c, width=2)
        else:
            d.line([(0, i), (size, i)], fill=c)
    return img


def _center(d, text, font, cy, fill, size=SIZE):
    bbox = d.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], cy - h / 2 - bbox[1]), text, font=font, fill=fill)


def logo_a() -> Image.Image:
    """GD branco sobre degradê rosa→laranja (mesmo do selo dos posts)."""
    img = _gradient(SIZE, PINK, ORANGE)
    d = ImageDraw.Draw(img)
    _center(d, "GD", f_display(560), SIZE * 0.47, WHITE)
    return img


def logo_b() -> Image.Image:
    """GD em degradê sobre fundo escuro + faixa 'DAILY'."""
    img = Image.new("RGB", (SIZE, SIZE), (14, 10, 24))
    mask = Image.new("L", (SIZE, SIZE), 0)
    _center(ImageDraw.Draw(mask), "GD", f_display(520), SIZE * 0.42, 255)
    img.paste(_gradient(SIZE, PINK, ORANGE), (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((250, 730, 830, 850), radius=28, fill=YELLOW)
    _center(d, "DAILY", f_display(96), 790, (14, 10, 24))
    return img


def logo_c() -> Image.Image:
    """Selo de notícia: círculo com 'GTA DAILY' e ponto vermelho 'ao vivo'."""
    img = Image.new("RGB", (SIZE, SIZE), (14, 10, 24))
    d = ImageDraw.Draw(img)
    d.ellipse((90, 90, 990, 990), outline=PINK, width=40)
    _center(d, "GTA", f_display(330), 430, WHITE)
    _center(d, "DAILY", f_display(200), 680, YELLOW)
    d.ellipse((760, 250, 840, 330), fill=(235, 30, 45))
    return img


def destaque(label: str, emoji_text: str) -> Image.Image:
    img = _gradient(SIZE, PINK, ORANGE)
    d = ImageDraw.Draw(img)
    _center(d, emoji_text, f_display(300), SIZE * 0.42, WHITE)
    _center(d, label.upper(), f_body(90, "Black"), SIZE * 0.72, (14, 10, 24))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="saida/perfil")
    out = Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    for name, fn in [("logo_A", logo_a), ("logo_B", logo_b), ("logo_C", logo_c)]:
        fn().save(out / f"{name}.png")
    for label, mark in [("Notícias", "NEWS"), ("Rumores", "???"), ("Contagem", "19/11")]:
        destaque(label, mark).save(out / f"destaque_{label.lower().replace('í', 'i')}.png")
    # prévia: como aparece pequeno no feed (110 px, círculo)
    prev = Image.new("RGB", (3 * 150 + 40, 190), (250, 250, 250))
    for i, name in enumerate(["logo_A", "logo_B", "logo_C"]):
        im = Image.open(out / f"{name}.png").resize((110, 110), Image.LANCZOS)
        m = Image.new("L", (110, 110), 0)
        ImageDraw.Draw(m).ellipse((0, 0, 109, 109), fill=255)
        prev.paste(im, (20 + i * 150 + 20, 20), m)
        ImageDraw.Draw(prev).text((20 + i * 150 + 60, 145), name[-1], font=f_body(28, "Bold"), fill=(30, 30, 30))
    prev.save(out / "previa_tamanho_real.png")
    for p in sorted(out.iterdir()):
        print(p)


if __name__ == "__main__":
    main()
