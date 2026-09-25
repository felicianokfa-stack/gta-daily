"""Transforma uma pauta (JSON) em carrossel (PNG 1080x1350) e Reel (MP4 1080x1920)
no estilo "portal de notícias gamer": mídia em tela cheia, manchete forte, selos.

Uso:
    python -m pipeline.render pautas/2026-09-24-01.json --out saida/

Mídia: somente material oficial com origem registrada (biblioteca/indice.json) ou
provisório para teste de layout. Vídeos entram SEM o áudio original.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from pipeline.caption import build_caption

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "templates" / "fonts"

LANCAMENTO_GTA6 = dt.date(2026, 11, 19)  # memoria/fatos.md

HANDLE = "@_gtadaily"
BRAND = "GTA DAILY"
FPS = 30

WHITE = (248, 248, 252)
MUTED = (190, 190, 205)
PINK = (255, 64, 129)
ORANGE = (255, 150, 40)
YELLOW = (255, 214, 10)
RED = (235, 30, 45)
TAG_COLORS = {
    "FATO": (46, 204, 113),
    "RUMOR": (255, 176, 32),
    "CURIOSIDADE": (80, 160, 255),
    "OPINIÃO": (190, 120, 255),
    "SEMANAL": (255, 64, 129),  # séries recorrentes com info de fontes especializadas
}
STATUS_COLORS = {"URGENTE": RED, "NOVO": PINK, "OFICIAL": (46, 204, 113), "VAZOU?": ORANGE}


# ================================================================ fontes

def f_display(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / "Anton-Regular.ttf"), size)


def f_body(size: int, weight: str = "SemiBold") -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTS / "Inter-var.ttf"), size)
    f.set_variation_by_name(weight)
    return f


# ================================================================ texto

def _greedy(words: list[str], font, max_w: int) -> list[list[str]]:
    lines, cur = [], []
    for w in words:
        if cur and font.getlength(" ".join(cur + [w])) > max_w:
            lines.append(cur)
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(cur)
    return lines


def balanced_wrap(text: str, font, max_w: int) -> list[list[str]]:
    """Quebra gulosa, depois estreita a largura até antes de criar linha extra —
    evita a última linha com uma palavra só."""
    words = text.split()
    best = _greedy(words, font, max_w)
    n = len(best)
    if n < 2:
        return best
    w = max_w
    while w > max_w * 0.55:
        w -= max_w * 0.03
        cand = _greedy(words, font, int(w))
        if len(cand) > n:
            break
        best = cand
    return best


def fit_lines(text, make_font, max_w, max_h, start, min_size, spacing):
    size = start
    while True:
        font = make_font(size)
        lines = balanced_wrap(text, font, max_w)
        lh = int(size * spacing)
        widest = max(font.getlength(" ".join(l)) for l in lines)
        if (len(lines) * lh <= max_h and widest <= max_w) or size <= min_size:
            return font, lines, lh
        size -= 4


def _norm(w: str) -> str:
    return "".join(c for c in w.upper() if c.isalnum())


def with_shadow(img: Image.Image, blur=8, strength=0.85) -> Image.Image:
    pad = blur * 2
    out = Image.new("RGBA", (img.width + pad, img.height + pad), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 255))
    sh.putalpha(img.getchannel("A").point(lambda v: int(v * strength)))
    out.alpha_composite(sh, (4, 5))
    out = out.filter(ImageFilter.GaussianBlur(blur))
    out.alpha_composite(img, (0, 0))
    return out


def headline(text: str, destaque: list[str], max_w: int, max_h: int, start: int) -> Image.Image:
    """Manchete em caixa alta; palavras de `destaque` em amarelo."""
    text = text.upper()
    hl = {_norm(w) for d in destaque for w in d.split()}
    font, lines, lh = fit_lines(text, f_display, max_w, max_h, start, 64, 1.02)
    space = font.getlength(" ")
    img = Image.new("RGBA", (max_w, lh * len(lines) + int(lh * 0.25)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        x = 0
        for w in line:
            d.text((x, i * lh), w, font=font, fill=YELLOW if _norm(w) in hl else WHITE)
            x += font.getlength(w) + space
    return with_shadow(img)


def paragraph(text: str, max_w: int, max_h: int, start=46, weight="SemiBold", fill=(232, 232, 240)) -> Image.Image:
    font, lines, lh = fit_lines(text, lambda s: f_body(s, weight), max_w, max_h, start, 28, 1.28)
    img = Image.new("RGBA", (max_w, lh * len(lines) + 10), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((0, i * lh), " ".join(line), font=font, fill=fill)
    return with_shadow(img, blur=5, strength=0.9)


def pill(label: str, bg, fg=(10, 10, 16), size=32, dot=False) -> Image.Image:
    font = f_body(size, "Black")
    px, py = int(size * 0.7), int(size * 0.32)
    dot_w = int(size * 0.75) if dot else 0
    w = int(font.getlength(label)) + px * 2 + dot_w
    h = int(size * 1.2) + py * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=int(h * 0.28), fill=bg)
    if dot:
        r = size // 4
        cy = h // 2
        d.ellipse((px - 4, cy - r, px - 4 + 2 * r, cy + r), fill=fg)
    d.text((px + dot_w, py - size * 0.08), label, font=font, fill=fg)
    return img


# ================================================================ mídia

def cover(img: Image.Image, size) -> Image.Image:
    w, h = size
    s = max(w / img.width, h / img.height)
    img = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def is_video(p: Path) -> bool:
    return p.suffix.lower() in {".mp4", ".mov", ".webm", ".m4v"}


def load_still(p: Path) -> Image.Image:
    if is_video(p):
        reader = imageio_ffmpeg.read_frames(str(p))
        meta = next(reader)
        frame = next(reader)
        reader.close()
        return Image.frombytes("RGB", meta["size"], frame)
    return Image.open(p).convert("RGB")


class VideoSource:
    """Lê frames de um vídeo (sem áudio), em loop, já recortados para `size`."""

    def __init__(self, path: Path, size, start: float = 0.0):
        self.path, self.size, self.start = path, size, start
        self._open()

    def _open(self):
        w, h = self.size
        self.reader = imageio_ffmpeg.read_frames(
            str(self.path), input_params=["-ss", f"{self.start:.2f}"],
            output_params=["-vf", f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={FPS}"])
        next(self.reader)  # metadados

    def next(self) -> Image.Image:
        try:
            buf = next(self.reader)
        except StopIteration:
            self._open()
            buf = next(self.reader)
        return Image.frombytes("RGB", self.size, buf)


def bottom_fade(size, start=0.38, strength=245) -> Image.Image:
    """Degradê preto no terço inferior (e leve no topo) para leitura."""
    w, h = size
    col = Image.new("L", (1, h))
    for y in range(h):
        t = y / h
        a = 0.0
        if t > start:
            a = strength * min(1.0, ((t - start) / (1 - start)) ** 0.8 * 1.25)
        if t < 0.16:
            a = max(a, 150 * (1 - t / 0.16))
        col.putpixel((0, y), int(min(255, a)))
    layer = Image.new("RGBA", size, (0, 0, 0, 255))
    layer.putalpha(col.resize(size))
    return layer


# ================================================================ marca

def logo(size=96) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGB", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / size
        gd.line([(0, y), (size, y)], fill=tuple(int(PINK[i] * (1 - t) + ORANGE[i] * t) for i in range(3)))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 4, fill=255)
    img.paste(grad, (0, 0), mask)
    f = f_display(int(size * 0.62))
    ImageDraw.Draw(img).text(((size - f.getlength("GD")) / 2, size * 0.1), "GD", font=f, fill=WHITE)
    return img


def top_bar(frame: Image.Image, status: str | None, pulse: float = 1.0, y: int = 56):
    w = frame.width
    frame.alpha_composite(logo(84), (56, y))
    d = ImageDraw.Draw(frame)
    d.text((56 + 84 + 20, y + 4), BRAND, font=f_display(44), fill=WHITE)
    d.text((56 + 84 + 22, y + 58), "notícias de GTA todo dia", font=f_body(20, "Medium"), fill=MUTED)
    if status:
        color = STATUS_COLORS.get(status.upper(), RED)
        p = pill(status.upper(), color, WHITE, size=30, dot=True)
        if pulse < 1:
            p.putalpha(p.getchannel("A").point(lambda a: int(a * (0.55 + 0.45 * pulse))))
        frame.alpha_composite(p, (w - 56 - p.width, y + 14))


def footer(frame: Image.Image, fonte: str | None, credito: str | None, y: int):
    d = ImageDraw.Draw(frame)
    w = frame.width
    d.rectangle((56, y, w - 56, y + 2), fill=(255, 255, 255, 60))
    # fonte e crédito em linhas separadas, para nunca cortar a atribuição
    fs = f_body(21, "Medium")
    lines = [p for p in [f"Fonte: {fonte}" if fonte else None, credito] if p]
    for i, txt in enumerate(lines):
        while fs.getlength(txt) > w * 0.62:
            txt = txt[:-2]
        d.text((56, y + 12 + i * 28), txt, font=fs, fill=MUTED)
    fh = f_body(26, "Bold")
    d.text((w - 56 - fh.getlength(HANDLE), y + 15), HANDLE, font=fh, fill=WHITE)


# ================================================================ pauta

@dataclass
class Tela:
    titulo: str
    texto: str = ""
    tag: str | None = None
    midia: str | None = None
    destaque: list[str] = field(default_factory=list)
    final: bool = False


def telas(pauta: dict) -> list[Tela]:
    midias = pauta.get("midia", [])

    def m(i, s=None):
        if s and s.get("midia"):
            return s["midia"]
        return midias[i % len(midias)] if midias else None

    out = [Tela(pauta["gancho"], pauta.get("subgancho", ""), pauta["tipo"], m(0), pauta.get("destaque", []))]
    for i, s in enumerate(pauta["slides"], start=1):
        out.append(Tela(s["titulo"], s.get("texto", ""), None, m(i, s), s.get("destaque", [])))
    out.append(Tela(pauta.get("cta", "Segue pra não perder nada"), pauta.get("cta_texto", ""), None,
                    m(len(out)), pauta.get("cta_destaque", []), final=True))
    return out


def text_layers(t: Tela, w: int, bottom: int, right_safe: int, is_cover: bool):
    """Camadas (tipo, imagem, x, y) empilhadas de baixo para cima até `bottom`."""
    margin = 56
    max_w = w - margin * 2 - right_safe
    items = []
    y = bottom
    if t.final:
        cta = pill("SEGUE  →  " + HANDLE, PINK, WHITE, size=34)
        y -= cta.height
        items.append(("cta", cta, margin, y))
        y -= 28
    if t.texto:
        body = paragraph(t.texto, max_w, 260, 44 if is_cover else 46)
        y -= body.height
        items.append(("body", body, margin, y))
        y -= 18
    head = headline(t.titulo, t.destaque, max_w, 520 if is_cover else 420, 158 if is_cover else 124)
    y -= head.height
    items.append(("head", head, margin, y))
    if t.tag:
        tag = pill(t.tag.upper(), TAG_COLORS.get(t.tag.upper(), PINK), size=30)
        y -= tag.height + 14
        items.append(("tag", tag, margin, y))
    return list(reversed(items))


def resolve(pauta_dir: Path, rel: str | None) -> Path | None:
    if not rel:
        return None
    for base in (pauta_dir, ROOT):
        p = (base / rel).resolve()
        if p.exists():
            return p
    raise FileNotFoundError(rel)


# ================================================================ carrossel

def render_carousel(pauta: dict, pauta_dir: Path, out: Path) -> list[Path]:
    size = w, h = (1080, 1350)
    ts = telas(pauta)
    fade = bottom_fade(size, start=0.34)
    paths = []
    for i, t in enumerate(ts):
        src = resolve(pauta_dir, t.midia)
        bg = cover(load_still(src), size) if src else Image.new("RGB", size, (14, 10, 24))
        frame = bg.convert("RGBA")
        frame.alpha_composite(fade)
        top_bar(frame, pauta.get("status") if i == 0 else None)
        for _, layer, x, y in text_layers(t, w, h - 150, 0, i == 0):
            frame.alpha_composite(layer, (x, y))
        footer(frame, pauta.get("fonte"), pauta.get("credito_imagem"), h - 110)
        if i == 0:
            a = pill("ARRASTA  →", WHITE, (10, 10, 16), size=24)
            frame.alpha_composite(a, (w - 56 - a.width, 180))
        else:
            fc = f_body(24, "Bold")
            cnt = f"{i + 1}/{len(ts)}"
            ImageDraw.Draw(frame).text((w - 56 - fc.getlength(cnt), 80), cnt, font=fc, fill=MUTED)
        p = out / f"carrossel_{i + 1:02d}.png"
        frame.convert("RGB").save(p, optimize=True)
        paths.append(p)
    return paths


# ================================================================ reel

def ease_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_back(t: float) -> float:
    """Leve 'overshoot' para o punch da manchete."""
    t = max(0.0, min(1.0, t))
    c = 1.9
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def render_reel(pauta: dict, pauta_dir: Path, out: Path) -> Path:
    size = w, h = (1080, 1920)
    ts = telas(pauta)
    durs = []
    for i, t in enumerate(ts):
        words = len((t.titulo + " " + t.texto).split())
        durs.append(2.6 if i == 0 else min(4.2, max(2.2, 0.9 + words * 0.26)))
    total = sum(durs)
    starts = [sum(durs[:i]) for i in range(len(durs))]
    n_frames = int(total * FPS)

    # zona segura do Reel: texto termina em ~70% da altura e deixa 130px à direita
    layers = [text_layers(t, w, int(h * 0.70), 130, i == 0) for i, t in enumerate(ts)]
    fade = bottom_fade(size, start=0.30, strength=235)

    zoom_pad = 1.12
    sources = []
    for t in ts:
        src = resolve(pauta_dir, t.midia)
        if src and is_video(src):
            sources.append(("video", src))
        elif src:
            sources.append(("image", cover(load_still(src), (int(w * zoom_pad), int(h * zoom_pad)))))
        else:
            sources.append(("image", Image.new("RGB", (int(w * zoom_pad), int(h * zoom_pad)), (14, 10, 24))))

    path = out / "reel.mp4"
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
        "-f", "lavfi", "-t", f"{total:.2f}", "-i", "anullsrc=r=44100:cl=stereo",
        "-map", "0:v", "-map", "1:a",  # nunca o áudio da mídia de origem
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19",
        "-profile:v", "high", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k", "-shortest", str(path),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    current, video = -1, None
    for f in range(n_frames):
        t = f / FPS
        idx = max(i for i, s in enumerate(starts) if s <= t)
        local = t - starts[idx]
        if idx != current:
            current = idx
            kind, src = sources[idx]
            video = VideoSource(src, size) if kind == "video" else None
        if video:
            frame = video.next().convert("RGBA")
        else:
            big = sources[idx][1]
            s = zoom_pad - 0.08 * (local / durs[idx])  # zoom lento de aproximação
            cw, ch = int(w * s), int(h * s)
            cx, cy = big.width // 2, big.height // 2
            frame = big.crop((cx - cw // 2, cy - ch // 2, cx + cw // 2, cy + ch // 2)).resize(size).convert("RGBA")
        frame.alpha_composite(fade)

        for kind, layer, x, y in layers[idx]:
            delay = {"tag": 0.0, "head": 0.08, "body": 0.35, "cta": 0.55}[kind]
            p = (local - delay) / (0.32 if kind == "head" else 0.4)
            if p <= 0:
                continue
            if p >= 1:
                frame.alpha_composite(layer, (x, y))
            elif kind == "head":
                sc = 1.18 - 0.18 * ease_back(p)
                lay = layer.resize((max(1, int(layer.width * sc)), max(1, int(layer.height * sc))))
                a = ease_out(p * 1.6)
                lay.putalpha(lay.getchannel("A").point(lambda v, a=a: int(v * a)))
                x2 = x - (lay.width - layer.width) // 2
                y2 = y - (lay.height - layer.height) // 2
                frame.alpha_composite(lay, (max(0, x2), max(0, y2)))
            else:
                e = ease_out(p)
                lay = layer.copy()
                lay.putalpha(layer.getchannel("A").point(lambda v, e=e: int(v * e)))
                frame.alpha_composite(lay, (int(x - (1 - e) * 50), y))

        pulse = 0.5 + 0.5 * math.cos(t * 2 * math.pi * 1.2)
        top_bar(frame, pauta.get("status"), pulse, y=150)
        d = ImageDraw.Draw(frame)
        d.rectangle((0, 0, w, 12), fill=(0, 0, 0, 120))
        d.rectangle((0, 0, int(w * (t / total)), 12), fill=PINK)
        if pauta.get("credito_imagem"):
            d.text((56, 262), pauta["credito_imagem"], font=f_body(22, "Medium"), fill=MUTED)
        if idx > 0 and local < 2 / FPS:  # flash curto no corte
            frame.alpha_composite(Image.new("RGBA", size, (255, 255, 255, 110)))
        proc.stdin.write(frame.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg falhou")
    return path


# ================================================================ tokens

def aplicar_tokens(obj, hoje: dt.date):
    """Substitui tokens dinâmicos (ex.: {dias_gta6}) em todos os textos da pauta."""
    tokens = {"{dias_gta6}": str((LANCAMENTO_GTA6 - hoje).days)}
    if isinstance(obj, str):
        for k, v in tokens.items():
            obj = obj.replace(k, v)
        return obj
    if isinstance(obj, list):
        return [aplicar_tokens(o, hoje) for o in obj]
    if isinstance(obj, dict):
        return {k: aplicar_tokens(v, hoje) for k, v in obj.items()}
    return obj


# ================================================================ CLI

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pauta")
    ap.add_argument("--out", default="saida")
    ap.add_argument("--so", choices=["carrossel", "reel"], help="gera só um formato")
    ap.add_argument("--data", type=dt.date.fromisoformat, default=dt.date.today(),
                    help="data de publicação (AAAA-MM-DD) para tokens como {dias_gta6}")
    args = ap.parse_args()

    pauta_path = Path(args.pauta).resolve()
    pauta = aplicar_tokens(json.loads(pauta_path.read_text(encoding="utf-8")), args.data)
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
