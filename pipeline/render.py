"""Transforma uma pauta (JSON) em carrossel (PNG 1080x1350) e Reel (MP4 1080x1920).

Uso:
    python -m pipeline.render pautas/2026-09-24-01.json --out saida/

Material permitido: texto próprio + imagem de fundo com origem registrada na pauta
(imagem oficial de divulgação ou gerada/licenciada). Nunca vídeo vazado ou corte sem autorização.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from pipeline.caption import build_caption

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "templates" / "fonts"

HANDLE = "@_gtadaily"
FPS = 30

# Paleta: noite + pôr do sol (identidade própria, sem logos/fontes da Rockstar).
BG_TOP = (18, 10, 38)
BG_BOTTOM = (8, 6, 16)
ACCENT = (255, 79, 139)  # rosa
ACCENT_2 = (255, 170, 60)  # laranja
WHITE = (245, 245, 250)
MUTED = (170, 170, 190)
TAG_COLORS = {
    "FATO": (46, 204, 113),
    "RUMOR": (255, 176, 32),
    "CURIOSIDADE": (80, 160, 255),
    "OPINIÃO": (190, 120, 255),
}


# ---------------------------------------------------------------- fontes / texto

def font_display(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / "Anton-Regular.ttf"), size)


def font_body(size: int, weight: str = "Medium") -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTS / "Inter-var.ttf"), size)
    f.set_variation_by_name(weight)
    return f


def wrap(text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split():
            test = f"{cur} {word}".strip()
            if font.getlength(test) <= max_w or not cur:
                cur = test
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines


def fit(text: str, make_font, max_w: int, max_h: int, start: int, min_size: int, spacing=1.12):
    """Maior tamanho de fonte em que o texto cabe na caixa."""
    size = start
    while True:
        font = make_font(size)
        lines = wrap(text, font, max_w)
        line_h = int(size * spacing)
        if len(lines) * line_h <= max_h or size <= min_size:
            return font, lines, line_h
        size -= 4


def text_block(text, make_font, max_w, max_h, start, min_size, fill, spacing=1.12, shadow=True):
    """Renderiza um bloco de texto num RGBA transparente do tamanho exato."""
    font, lines, line_h = fit(text, make_font, max_w, max_h, start, min_size, spacing)
    h = line_h * len(lines) + 12
    img = Image.new("RGBA", (max_w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((0, i * line_h), line, font=font, fill=fill)
    if shadow:
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sh.putalpha(img.getchannel("A").filter(ImageFilter.GaussianBlur(6)).point(lambda a: a * 0.7))
        base = Image.new("RGBA", img.size, (0, 0, 0, 0))
        base.alpha_composite(sh.crop((0, 0, sh.width - 3, sh.height - 4)), (3, 4))
        base.alpha_composite(img)
        img = base
    return img


def tag_badge(label: str, scale: float = 1.0) -> Image.Image:
    color = TAG_COLORS.get(label.upper(), ACCENT)
    font = font_body(int(34 * scale), "Black")
    pad_x, pad_y = int(22 * scale), int(10 * scale)
    w = int(font.getlength(label.upper())) + pad_x * 2
    h = int(34 * scale * 1.25) + pad_y * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=color)
    d.text((pad_x, pad_y - int(2 * scale)), label.upper(), font=font, fill=(10, 10, 16))
    return img


# ---------------------------------------------------------------- fundo

def gradient(size) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    # brilho de "pôr do sol" no canto
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse((int(w * 0.35), int(-h * 0.25), int(w * 1.5), int(h * 0.45)), fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(w // 5))
    img.paste(Image.new("RGB", size, ACCENT), (0, 0), glow.point(lambda a: a * 0.45))
    return img


def cover(img: Image.Image, size) -> Image.Image:
    w, h = size
    s = max(w / img.width, h / img.height)
    img = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def background(size, image_path: str | None, pauta_dir: Path) -> Image.Image:
    base = gradient(size)
    if image_path:
        p = (pauta_dir / image_path).resolve()
        photo = cover(Image.open(p).convert("RGB"), size)
        # escurece a foto e aplica o degradê por cima para garantir leitura do texto
        base = Image.blend(photo, base, 0.55)
    # vinheta inferior para o bloco de texto
    w, h = size
    shade = Image.new("L", size, 0)
    ImageDraw.Draw(shade).rectangle((0, int(h * 0.45), w, h), fill=210)
    shade = shade.filter(ImageFilter.GaussianBlur(h // 8))
    base.paste(Image.new("RGB", size, (0, 0, 0)), (0, 0), shade)
    return base


def chrome(img: Image.Image, fonte: str | None, page: str | None):
    """Rodapé com @ e fonte; numeração de página."""
    w, h = img.size
    d = ImageDraw.Draw(img)
    f = font_body(30, "Bold")
    d.text((64, h - 92), HANDLE, font=f, fill=WHITE)
    d.rectangle((64, h - 104, 64 + 80, h - 98), fill=ACCENT)
    if fonte:
        fs = font_body(24, "Regular")
        txt = f"Fonte: {fonte}"
        while fs.getlength(txt) > w * 0.55 and len(txt) > 10:
            txt = txt[:-2]
        d.text((w - 64 - fs.getlength(txt), h - 86), txt, font=fs, fill=MUTED)
    if page:
        fp = font_body(26, "SemiBold")
        d.text((w - 64 - fp.getlength(page), 60), page, font=fp, fill=MUTED)


# ---------------------------------------------------------------- pauta

@dataclass
class Tela:
    titulo: str
    texto: str = ""
    tag: str | None = None


def telas(pauta: dict) -> list[Tela]:
    out = [Tela(pauta["gancho"], pauta.get("subgancho", ""), pauta["tipo"])]
    out += [Tela(s["titulo"], s.get("texto", "")) for s in pauta["slides"]]
    out.append(Tela(pauta.get("cta", "Segue pra não perder nada de GTA"), pauta.get("cta_texto", ""), None))
    return out


def layers(t: Tela, w: int, h: int, is_cover: bool, bottom: int | None = None, right_safe: int = 0):
    """Camadas de texto de uma tela: [(imagem, x, y)].

    bottom: linha de base do bloco de texto; right_safe: faixa à direita livre
    (no Reel, os botões do Instagram ocupam a lateral direita e a legenda o rodapé).
    """
    margin = 64
    max_w = w - margin * 2 - right_safe
    items = []
    title_size = 150 if is_cover else 104
    title = text_block(t.titulo.upper(), font_display, max_w, int(h * 0.36), title_size, 60, WHITE, 1.05)
    body = None
    if t.texto:
        body = text_block(t.texto, lambda s: font_body(s, "Medium"), max_w, int(h * 0.22), 48, 30, (225, 225, 235), 1.3, shadow=False)
    badge = tag_badge(t.tag) if t.tag else None
    # empilha de baixo para cima a partir do rodapé
    y = bottom if bottom is not None else h - 150
    if body:
        y -= body.height
        items.append([body, margin, y])
        y -= 28
    y -= title.height
    items.append([title, margin, y])
    y -= 18
    bar = Image.new("RGBA", (140, 10), ACCENT + (255,))
    items.append([bar, margin, y - 10])
    y -= 10
    if badge:
        y -= badge.height + 24
        items.append([badge, margin, y])
    return list(reversed(items))  # ordem de entrada na animação: badge, barra, título, corpo


# ---------------------------------------------------------------- carrossel

def render_carousel(pauta: dict, pauta_dir: Path, out: Path) -> list[Path]:
    size = (1080, 1350)
    ts = telas(pauta)
    bg = background(size, pauta.get("imagem_fundo"), pauta_dir)
    paths = []
    for i, t in enumerate(ts):
        img = bg.copy().convert("RGBA")
        for layer, x, y in layers(t, *size, is_cover=(i == 0)):
            img.alpha_composite(layer, (x, y))
        img = img.convert("RGB")
        chrome(img, pauta.get("fonte") if i in (0, len(ts) - 1) else None, f"{i + 1}/{len(ts)}")
        if i == 0:
            ImageDraw.Draw(img).text((64, 60), "ARRASTA →", font=font_body(28, "Bold"), fill=ACCENT_2)
        p = out / f"carrossel_{i + 1:02d}.png"
        img.save(p, optimize=True)
        paths.append(p)
    return paths


# ---------------------------------------------------------------- reel

def ease_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def render_reel(pauta: dict, pauta_dir: Path, out: Path) -> Path:
    w, h = size = (1080, 1920)
    ts = telas(pauta)
    # duração por tela proporcional ao texto (tempo de leitura), com limites
    durs = []
    for i, t in enumerate(ts):
        words = len((t.titulo + " " + t.texto).split())
        durs.append(min(4.5, max(2.2, 1.0 + words * 0.28)) if i else 2.4)
    total = sum(durs)
    n_frames = int(total * FPS)

    bg_big = background((int(w * 1.08), int(h * 1.08)), pauta.get("imagem_fundo"), pauta_dir)
    # zona segura do Reel: texto termina em ~68% da altura e deixa 120px à direita
    prepared = [layers(t, w, h, is_cover=(i == 0), bottom=int(h * 0.68), right_safe=120) for i, t in enumerate(ts)]
    starts = [sum(durs[:i]) for i in range(len(durs))]

    path = out / "reel.mp4"
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
        "-f", "lavfi", "-t", f"{total:.2f}", "-i", "anullsrc=r=44100:cl=stereo",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
        "-profile:v", "high", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k", "-shortest", str(path),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    handle_font = font_body(34, "Bold")
    for f in range(n_frames):
        t = f / FPS
        idx = max(i for i, s in enumerate(starts) if s <= t)
        local = t - starts[idx]
        # Ken Burns lento no fundo inteiro
        z = t / total
        ox, oy = int((bg_big.width - w) * z), int((bg_big.height - h) * (1 - z) * 0.5)
        frame = bg_big.crop((ox, oy, ox + w, oy + h)).convert("RGBA")
        for k, (layer, x, y) in enumerate(prepared[idx]):
            p = ease_out((local - k * 0.12) / 0.45)
            if p <= 0:
                continue
            lay = layer
            if p < 1:
                lay = layer.copy()
                lay.putalpha(layer.getchannel("A").point(lambda a, p=p: int(a * p)))
            frame.alpha_composite(lay, (int(x - (1 - p) * 60), int(y)))
        frame = frame.convert("RGB")
        d = ImageDraw.Draw(frame)
        # barra de progresso (sinal de "vale ver até o fim")
        d.rectangle((0, 0, int(w * (t / total)), 10), fill=ACCENT)
        d.text((64, 150), HANDLE, font=handle_font, fill=WHITE)
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg falhou")
    return path


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pauta")
    ap.add_argument("--out", default="saida")
    ap.add_argument("--so", choices=["carrossel", "reel"], help="gera só um formato")
    args = ap.parse_args()

    pauta_path = Path(args.pauta).resolve()
    pauta = json.loads(pauta_path.read_text(encoding="utf-8"))
    out = Path(args.out) / pauta["id"]
    out.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    if args.so != "reel":
        for p in render_carousel(pauta, pauta_path.parent, out):
            print(p)
    if args.so != "carrossel":
        print(render_reel(pauta, pauta_path.parent, out))
    (out / "legenda.txt").write_text(build_caption(pauta), encoding="utf-8")
    print(out / "legenda.txt")
    print(f"tempo_pipeline_s={time.time() - t0:.1f}")


if __name__ == "__main__":
    main()
