"""Gera mídia PROVISÓRIA (cena de pôr do sol procedural) para testar layout
enquanto a biblioteca oficial não está disponível. Nunca publicar com ela.

Uso:
    python -m pipeline.placeholder --out biblioteca/provisorio
"""
from __future__ import annotations

import argparse
import random
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFilter


def _lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _sky(d, w, horizon, stops):
    for y in range(horizon):
        t = y / horizon
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                d.line([(0, y), (w, y)], fill=_lerp(c0, c1, (t - t0) / (t1 - t0)))
                break


def _palm(d, x, base, h, color):
    # tronco curvo + folhas
    pts = [(x + int(8 * (i / 20) ** 2 * 6), base - int(h * i / 20)) for i in range(21)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d.line([(x0, y0), (x1, y1)], fill=color, width=max(6, h // 28))
    tx, ty = pts[-1]
    for ang, ln in [(-160, 1.0), (-130, 0.9), (-100, 0.7), (-60, 0.8), (-25, 1.0), (10, 0.85), (-200, 0.8)]:
        import math
        a = math.radians(ang)
        L = h * 0.45 * ln
        mx, my = tx + math.cos(a) * L * 0.5, ty + math.sin(a) * L * 0.5 - L * 0.08
        ex, ey = tx + math.cos(a) * L, ty + math.sin(a) * L + L * 0.25
        d.line([(tx, ty), (mx, my), (ex, ey)], fill=color, width=max(5, h // 40), joint="curve")


def scene(size=(2160, 2700), seed=1, mood="sunset") -> Image.Image:
    rnd = random.Random(seed)
    w, h = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    horizon = int(h * 0.62)
    palettes = {
        "sunset": [(0, (40, 18, 70)), (0.45, (190, 50, 110)), (0.8, (255, 120, 70)), (1, (255, 190, 90))],
        "night": [(0, (8, 8, 30)), (0.6, (40, 20, 80)), (1, (120, 40, 120))],
        "day": [(0, (40, 120, 210)), (0.7, (120, 190, 240)), (1, (250, 210, 170))],
    }
    _sky(d, w, horizon, palettes[mood])
    # sol
    sun = Image.new("L", size, 0)
    r = int(w * 0.22)
    cx, cy = int(w * 0.5), int(horizon - r * 0.35)
    ImageDraw.Draw(sun).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    for i in range(7):
        y = cy + int(r * 0.1) + i * int(r * 0.13)
        ImageDraw.Draw(sun).rectangle((0, y, w, y + int(r * 0.035) + i * 3), fill=0)
    img.paste(Image.new("RGB", size, (255, 214, 120) if mood != "night" else (250, 240, 255)), (0, 0), sun)
    # mar
    for y in range(horizon, h):
        t = (y - horizon) / (h - horizon)
        d.line([(0, y), (w, y)], fill=_lerp((70, 30, 90), (10, 8, 25), t))
    for _ in range(140):
        y = rnd.randint(horizon, h)
        x = cx + rnd.randint(-r, r)
        d.line([(x - rnd.randint(10, 80), y), (x + rnd.randint(10, 80), y)], fill=(255, 170, 110), width=3)
    # skyline
    sil = (22, 10, 38) if mood != "day" else (40, 50, 80)
    x = 0
    while x < w:
        bw = rnd.randint(w // 30, w // 12)
        bh = rnd.randint(int(h * 0.05), int(h * 0.28))
        d.rectangle((x, horizon - bh, x + bw, horizon), fill=sil)
        if mood != "day":
            for wy in range(horizon - bh + 12, horizon - 8, 22):
                for wx in range(x + 8, x + bw - 8, 18):
                    if rnd.random() < 0.28:
                        d.rectangle((wx, wy, wx + 6, wy + 9), fill=(255, 200, 120))
        x += bw + rnd.randint(0, 12)
    # palmeiras em primeiro plano
    for px, ph in [(int(w * 0.08), int(h * 0.55)), (int(w * 0.2), int(h * 0.42)), (int(w * 0.86), int(h * 0.5))]:
        _palm(d, px, h, ph, (12, 6, 20))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    # granulado
    noise = Image.effect_noise(size, 18).convert("RGB")
    return Image.blend(img, noise, 0.06)


def pan_video(img: Image.Image, path: Path, seconds=4, size=(1080, 1920), fps=30):
    """Vídeo provisório com panorâmica, para testar o caminho de vídeo do pipeline."""
    w, h = size
    s = max(w * 1.25 / img.width, h / img.height)
    big = img.resize((int(img.width * s), int(img.height * s)))
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{w}x{h}", "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = seconds * fps
    for f in range(n):
        x = int((big.width - w) * f / n)
        p.stdin.write(big.crop((x, 0, x + w, h)).tobytes())
    p.stdin.close()
    p.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="biblioteca/provisorio")
    out = Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    for i, mood in enumerate(["sunset", "night", "day", "sunset"]):
        scene(seed=i + 1, mood=mood).save(out / f"cena_{i + 1}.jpg", quality=90)
        print(out / f"cena_{i + 1}.jpg")
    pan_video(scene(seed=9, mood="night"), out / "clipe_1.mp4")
    print(out / "clipe_1.mp4")


if __name__ == "__main__":
    main()
