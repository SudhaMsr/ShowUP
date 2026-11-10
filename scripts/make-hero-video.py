#!/usr/bin/env python3
"""Renders the looping product demo on the welcome screen (public/media/hero.mp4 + hero-poster.png).

An opportunity card moves Found -> Applied -> Offer on a stage board while a deadline reminder slides in.
Needs Pillow and ffmpeg:  python3 scripts/make-hero-video.py
"""
import math, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

W, H, S = 960, 540, 2            # output size, supersampling factor
FPS, SECONDS = 24, 8
N = FPS * SECONDS
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'media')

BG, PANEL, LINE, INK, MUTED = '#f7f6f3', '#ffffff', '#e6e4de', '#2b2a27', '#7b7872'
BLUE, GREEN, AMBER, VIOLET = '#2f6feb', '#1f9d68', '#e3a008', '#7a5af8'
COLS = [('Found', '#6b7280'), ('Preparing', AMBER), ('Applied', BLUE), ('Offer', GREEN)]

def font(size, bold=False):
    for p in ['/usr/share/fonts/opentype/inter/Inter-%s.otf' % ('SemiBold' if bold else 'Regular'),
              '/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else ''),
              '/usr/share/fonts/truetype/liberation/LiberationSans-%s.ttf' % ('Bold' if bold else 'Regular')]:
        if os.path.exists(p):
            return ImageFont.truetype(p, int(size * S))
    return ImageFont.load_default()

F = {k: font(v[0], v[1]) for k, v in dict(h=(15, True), t=(13, True), s=(11, False), b=(11, True), x=(10, False)).items()}
ease = lambda t: t * t * (3 - 2 * t)
clamp = lambda v: max(0.0, min(1.0, v))
seg = lambda t, a, b: ease(clamp((t - a) / (b - a)))

def rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle([v * S for v in box], r * S, fill=fill, outline=outline, width=int(width * S))

def text(d, xy, s, f, fill):
    d.text((xy[0] * S, xy[1] * S), s, font=f, fill=fill)

CX = [40 + i * 224 for i in range(4)]           # column x
COLW, TOP = 208, 86

def frame(i):
    t = i / N
    im = Image.new('RGB', (W * S, H * S), BG)
    d = ImageDraw.Draw(im)
    # window chrome
    rr(d, (16, 14, W - 16, H - 14), 14, PANEL, LINE)
    for k, c in enumerate(['#ff5f57', '#febc2e', '#28c840']):
        d.ellipse([(34 + k * 18) * S, 30 * S, (44 + k * 18) * S, 40 * S], fill=c)
    text(d, (W / 2 - 60, 29), 'ShowUp  ·  Board by stage', F['s'], MUTED)
    # columns
    for (name, col), x in zip(COLS, CX):
        rr(d, (x, TOP, x + COLW, H - 40), 10, '#faf9f7', LINE)
        d.ellipse([(x + 14) * S, (TOP + 15) * S, (x + 22) * S, (TOP + 23) * S], fill=col)
        text(d, (x + 30, TOP + 10), name, F['b'], INK)
    # static cards
    def card(x, y, title, sub, tag, tagc, alpha=1.0, lift=0.0, prog=None):
        if lift:
            rr(d, (x + 2, y + 6 + lift * 4, x + COLW - 14 + 2, y + 62 + 6 + lift * 4), 9, '#e4e2dc')
        rr(d, (x, y - lift * 3, x + COLW - 14, y + 62 - lift * 3), 9, PANEL, tagc if lift else LINE, 1.6 if lift else 1)
        text(d, (x + 12, y + 9 - lift * 3), title, F['t'], INK)
        text(d, (x + 12, y + 28 - lift * 3), sub, F['x'], MUTED)
        rr(d, (x + 12, y + 42 - lift * 3, x + 12 + 8 + len(tag) * 6.2, y + 56 - lift * 3), 7, tagc + '22' if False else '#eef2fb' if tagc == BLUE else '#eaf6f0' if tagc == GREEN else '#fbf3de' if tagc == AMBER else '#eeeeee')
        text(d, (x + 17, y + 42 - lift * 3), tag, F['x'], tagc)
    y0 = TOP + 40
    card(CX[0] + 8, y0 + 0, 'Rhodes Scholarship', 'Deadline 28 Nov', 'Found', '#6b7280')
    card(CX[0] + 8, y0 + 76, 'Hack the North', 'Registered', 'Found', '#6b7280')
    card(CX[1] + 8, y0 + 0, 'Stripe intern', 'Deadline 5 Dec', 'Preparing', AMBER)
    card(CX[3] + 8, y0 + 0, 'Meta intern', 'Offer received', 'Offer', GREEN)
    # moving hero card: Found -> Preparing -> Applied -> Offer
    stops = [(CX[0] + 8, y0 + 152), (CX[1] + 8, y0 + 76), (CX[2] + 8, y0 + 0), (CX[3] + 8, y0 + 76)]
    tags = [('Found', '#6b7280'), ('Preparing', AMBER), ('Applied', BLUE), ('Offer', GREEN)]
    times = [0.0, 0.22, 0.46, 0.70]
    k = 0
    for j in range(1, 4):
        if t >= times[j] + 0.09: k = j
    if k < 3 and t >= times[k + 1]:
        a, b, p = stops[k], stops[k + 1], seg(t, times[k + 1], times[k + 1] + 0.09)
    else:
        a = b = stops[k]; p = 1
    x, y = a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p
    moving = 0 < p < 1
    tag = tags[min(3, k + (1 if p > 0.5 and k < 3 and t >= times[k + 1] else 0))] if t >= 0 else tags[0]
    card(x, y, 'Google STEP intern', 'Deadline 20 Nov', tag[0], tag[1], lift=1.0 if moving else 0.0)
    # checklist progress ring-ish bar under hero card column
    prog = clamp((t - 0.05) / 0.6)
    rr(d, (CX[0] + 8, H - 62, CX[0] + 8 + 196, H - 54), 4, '#ecebe6')
    rr(d, (CX[0] + 8, H - 62, CX[0] + 8 + 196 * prog + 1, H - 54), 4, BLUE)
    text(d, (CX[0] + 8, H - 80), 'Checklist %d/5' % round(prog * 5), F['x'], MUTED)
    # reminder toast slides in from the right around 0.30 and out at 0.52
    tp = seg(t, 0.30, 0.36) - seg(t, 0.52, 0.58)
    if tp > 0:
        tx = W - 40 - 250 * tp
        rr(d, (tx + 3, 56 + 5, tx + 250 + 3, 118 + 5), 12, '#dcdad4')
        rr(d, (tx, 56, tx + 250, 118), 12, '#1f2430')
        d.ellipse([(tx + 14) * S, 70 * S, (tx + 34) * S, 90 * S], fill=AMBER)
        text(d, (tx + 20, 71), '!', F['b'], '#1f2430')
        text(d, (tx + 44, 66), 'Google STEP intern', F['t'], '#ffffff')
        text(d, (tx + 44, 86), 'Deadline in 3 days · Preparing', F['x'], '#c9ccd4')
    # confetti when the offer lands
    cp = clamp((t - 0.80) / 0.16)
    if 0 < cp < 1:
        for q in range(26):
            ang = q * 2.399
            r = 20 + 140 * cp * (0.5 + (q % 5) / 8)
            cx2 = CX[3] + 110 + math.cos(ang) * r
            cy2 = y0 + 80 + math.sin(ang) * r * 0.8 + 60 * cp * cp
            col = [BLUE, GREEN, AMBER, VIOLET, '#ef476f'][q % 5]
            d.rectangle([cx2 * S, cy2 * S, (cx2 + 6) * S, (cy2 + 6) * S], fill=col)
    return im.resize((W, H), Image.LANCZOS)

def main():
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is required')
    tmp = tempfile.mkdtemp()
    for i in range(N):
        frame(i).save(os.path.join(tmp, 'f%04d.png' % i))
    os.makedirs(OUT, exist_ok=True)
    frame(int(N * 0.72)).save(os.path.join(OUT, 'hero-poster.png'), optimize=True)
    subprocess.check_call(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(tmp, 'f%04d.png'),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
        os.path.join(OUT, 'hero.mp4')])
    shutil.rmtree(tmp)
    for f in ('hero.mp4', 'hero-poster.png'):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')

if __name__ == '__main__':
    main()
