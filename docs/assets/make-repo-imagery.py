#!/usr/bin/env python3
"""Draw the README hero, the social preview and the QR code for this repo.

The hero and the social preview are stills of the workshop site's background, the swarm: thousands of points flowing
in streams across the page, and the ones that gather sitting in a sphere, an ordered dither (Bayer 8 by 8) lit teal
from the lower right. The math is ported here from the site and drawn at the moment its still frame shows, with the
seed of its home page, so every run draws the same picture. The light version has dark streams on a light ground and
the sphere in pale teal to ocean blue. Over it sits the type, a small muted label over a large, tight title, and on
the README hero a card's hairline edge.

The QR code is the code in repo-qr.svg, dark on a light square that dissolves into the ground through the same
ordered dither.

Everything is SVG, so it stays sharp at any size and the publish step (text files only) takes it. The type is live
text in the system font stack the site uses (SF Pro on Apple devices, Segoe UI on Windows), so no font file ships.

  python3 docs/assets/make-repo-imagery.py            writes the SVGs next to this script
  python3 docs/assets/make-repo-imagery.py --png DIR  also saves PNGs with a headless Chrome, Edge or Chromium
                                                      (a throwaway profile, no window), then checks that the QR
                                                      code decodes if zxing-cpp or OpenCV is installed

Writes:
  repo-hero-dark.svg, repo-hero-light.svg  the README hero; README.md picks one with prefers-color-scheme
  repo-social-preview.svg                  1280 by 640; GitHub takes a PNG of it (Settings, Social preview, Edit)
  repo-qr-dither.svg                       the code in repo-qr.svg, dark on the dither's light

Python 3.8 or newer, standard library only.
"""
import argparse
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
URL = 'https://github.com/eli-w-king/autonomous-output-skills'
LABEL = 'eli-w-king'
NAME = ('Autonomous', 'output skills')
LINE = 'Agent skills for the work I hand to Copilot and walk away from.'

FONT = ("-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', Inter, "
        "system-ui, 'Helvetica Neue', Arial, sans-serif")

# The card and its type: ground, title, the muted label and a hairline edge.
CARD = {
    'dark': {'ground': '#0d1014', 'type': '#f1f1f1', 'label': '#c4ccd4', 'edge': ('#ffffff', 0.12)},
    'light': {'ground': '#ffffff', 'type': '#0d1014', 'label': '#5c6670', 'edge': ('#0d1014', 0.16)},
}

# The swarm's colors, as the site has them. Dark: light streams on the near-black ground, the sphere from deep ocean
# in its shadow to cyan where it's lit. Light: dark streams on the light ground, the sphere from pale teal to ocean.
# 'floor' is how much of the field stays behind the type.
SWARM = {
    'dark': {'ink': (226, 230, 234), 'ramp': ((10, 52, 72), (30, 135, 168), (72, 194, 205), (117, 226, 225)),
             'floor': 0.1},
    'light': {'ink': (13, 16, 20), 'ramp': ((206, 241, 241), (117, 226, 225), (56, 172, 194), (30, 135, 168)),
              'floor': 0.07},
}
RAMP_AT = (0, 0.4, 0.72, 1)
SEED = 0  # the site's home page
MOMENT = 36 * 0.62  # seconds into the swarm's 36 second cycle: the site's still frame, the sphere fully gathered

# The QR code's dither: the swarm's dark ramp.
DITHER = tuple(zip(RAMP_AT, SWARM['dark']['ramp']))

BAYER = (
    (0, 32, 8, 40, 2, 34, 10, 42),
    (48, 16, 56, 24, 50, 18, 58, 26),
    (12, 44, 4, 36, 14, 46, 6, 38),
    (60, 28, 52, 20, 62, 30, 54, 22),
    (3, 35, 11, 43, 1, 33, 9, 41),
    (51, 19, 59, 27, 49, 17, 57, 25),
    (15, 47, 7, 39, 13, 45, 5, 37),
    (63, 31, 55, 23, 61, 29, 53, 21),
)

# Sizes in px. 'dpr' is how many of these px make one px of the site, so the points have the site's grain where the
# image is shown (GitHub shows the hero about 830 px wide). Each text is (x, baseline, size), or (x, first baseline,
# second baseline, size) for the two-line name. The README hero has no 'line', because the README's first line says
# it right below; a link preview shows alone, so the social preview keeps it.
HERO = {'size': (1280, 560), 'radius': 12, 'dpr': 1.5, 'label': (80, 102, 24), 'name': (80, 198, 280, 80)}
SOCIAL = {'size': (1280, 640), 'radius': 0, 'dpr': 1.5, 'label': (80, 114, 28), 'name': (80, 230, 324, 94),
          'line': (80, 552, 28)}

M32 = 0xFFFFFFFF


def hashu(x):
    """The site's integer hash (32 bit)."""
    x &= M32
    x ^= x >> 16
    x = (x * 0x7feb352d) & M32
    x ^= x >> 15
    x = (x * 0x846ca68b) & M32
    x ^= x >> 16
    return x


def rnd(x):
    return hashu(x) / 4294967296.0


def mix(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def js_round(x):
    return math.floor(x + 0.5)


def hex_color(rgb):
    return '#%02x%02x%02x' % tuple(min(255, max(0, round(c))) for c in rgb)


def shade(stops, t):
    t = min(1.0, max(0.0, t))
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return '#%02x%02x%02x' % tuple(round(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
    return '#%02x%02x%02x' % stops[-1][1]


def ramp(colors, s):
    s = min(1.0, max(0.0, s))
    for i in (1, 2, 3):
        if s < RAMP_AT[i] or i == 3:
            k = (s - RAMP_AT[i - 1]) / (RAMP_AT[i] - RAMP_AT[i - 1])
            return tuple(mix(colors[i - 1][c], colors[i][c], k) for c in range(3))


def flow_at(c, a, b, c1, d):
    """How far along its stream a gathering point is at cycle phase c: it slows into the form, holds, then speeds
    back up, so the stream carries on where it left off."""
    def s1(x):
        return x * x * x - 0.5 * x * x * x * x
    if c < a:
        ie = 0.0
    elif c < b:
        ie = (b - a) * s1((c - a) / (b - a))
    elif c < c1:
        ie = 0.5 * (b - a) + (c - b)
    elif c < d:
        x = (c - c1) / (d - c1)
        ie = 0.5 * (b - a) + (c1 - b) + (d - c1) * (x - s1(x))
    else:
        ie = 0.5 * (b - a) + (c1 - b) + 0.5 * (d - c1)
    return c - ie


class Swarm:
    """The site's swarm at one moment, on a w by h canvas (dpr canvas px to one site px), with the type's box dimmed:
    what the site's vertex shader computes, one point at a time."""

    def __init__(self, w, h, dpr, scheme, avoid, clear=None):
        self.w, self.h, self.dpr = w, h, dpr
        self.colors = SWARM[scheme]
        self.seedu = (SEED * 0x9e3779b9 + 0x632be5ab) & M32
        self.box, self.clear, self.feather = avoid, clear, 150 * dpr
        self.until, self.fade = h + 2, h * 0.16
        # The form: a sphere on the right, its cells kept where the light beats their threshold in the Bayer matrix.
        css_w, css_h = w / dpr, h / dpr
        self.cell = 4
        r = min(css_h * 0.34, css_w * 0.21)
        cx, cy = css_w * 0.7, css_h * 0.5
        self.form = (cx, cy, r)
        lx, ly, lz = 0.55, 0.5, 0.67
        n = math.sqrt(lx * lx + ly * ly + lz * lz)
        self.points = []
        for gy in range(math.floor((cy - r) / self.cell), math.ceil((cy + r) / self.cell) + 1):
            for gx in range(math.floor((cx - r) / self.cell), math.ceil((cx + r) / self.cell) + 1):
                x, y = (gx + 0.5) * self.cell, (gy + 0.5) * self.cell
                dx, dy = (x - cx) / r, (y - cy) / r
                rr = dx * dx + dy * dy
                if rr > 1:
                    continue
                nz = math.sqrt(1 - rr)
                lam = max(0.0, (dx * lx + dy * ly + nz * lz) / n)
                rim = (1 - nz) ** 3 * 0.4 * max(0.0, dx * 0.6 + dy * 0.8)
                lit = min(1.0, (lam ** 1.3 + rim) * (0.25 + 0.75 * nz ** 0.6))
                if lit > (BAYER[gy % 8][gx % 8] + 0.5) / 64:
                    self.points.append((x, y, lit))
        # Everyone else streams.
        self.points += [(0.0, 0.0, -1.0)] * js_round(len(self.points) * 1.3)

    def h2(self, ix, iy):
        return rnd(((ix & M32) * 0x8da6b343 & M32) ^ hashu((iy & M32) ^ self.seedu))

    def vnoise(self, x, y):
        ix, iy = math.floor(x), math.floor(y)
        fx, fy = x - ix, y - iy
        ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        top = mix(self.h2(ix, iy), self.h2(ix + 1, iy), ux)
        return mix(top, mix(self.h2(ix, iy + 1), self.h2(ix + 1, iy + 1), ux), uy)

    def keep(self, x, y):
        """1 away from the type, the floor behind the title, with a soft edge; and nothing right behind a line that
        has to sit on the plain ground."""
        def dist(box):
            x0, y0, x1, y1 = box
            dx = abs(x - (x0 + x1) / 2) - (x1 - x0) / 2
            dy = abs(y - (y0 + y1) / 2) - (y1 - y0) / 2
            return math.hypot(max(dx, 0.0), max(dy, 0.0)) + min(max(dx, dy), 0.0)
        k = mix(self.colors['floor'], 1.0, smoothstep(0, self.feather, dist(self.box)))
        if self.clear:
            k *= smoothstep(0, self.feather * 0.6, dist(self.clear))
        return k

    def fade_out(self, y):
        return 1 - smoothstep(self.until - self.fade, self.until, y)

    def draw(self, dot):
        """Calls dot(x, y, rgb, alpha, size, in_form) for every point that shows, in canvas px."""
        css_w, css_h = self.w / self.dpr, self.h / self.dpr
        fx, fy, r = self.form
        t = MOMENT
        cyc = t / 36
        c = cyc - math.floor(cyc)
        m = 0.1 * css_w
        span = css_w + 2 * m
        for i, (ax, ay, az) in enumerate(self.points):
            h = hashu(((i * 0x9e3779b9) & M32) ^ self.seedu)
            r0, r1, r2, r3 = (rnd(h ^ k) for k in (0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1))
            gathers = az >= 0
            if gathers:
                lane = min(max(math.floor((ay - (fy - r)) / (2 * r) * 6), 0), 5)
                delay = 0.05 * min(1.0, max(0.0, (ax - (fx - r)) / (2 * r))) + 0.025 * r3
            else:
                lane, delay = math.floor(r0 * 6), 0.0
            hs = hashu(((lane * 0x7feb352d) & M32) ^ self.seedu ^ 0x3c6ef372)
            a0, b0, c1, d0 = 0.3 + delay, 0.46 + delay, 0.76 + delay, 0.9 + delay
            e = smoothstep(a0, b0, c) * (1 - smoothstep(c1, d0, c)) if gathers else 0.0
            per = 1 - (0.5 * (b0 - a0) + (c1 - b0) + 0.5 * (d0 - c1))
            vx = span / per
            if gathers:
                tau = math.floor(cyc) * per + flow_at(c, a0, b0, c1, d0)
                x0 = ax - 24 - flow_at(0.5 * (a0 + b0), a0, b0, c1, d0) * vx
                x = (x0 + tau * vx + m) % span - m
            else:
                x = (r1 * span + cyc * vx * (0.55 + 0.35 * r3) * per) % span - m
            mid = (lane + 0.5) / 6
            pull = math.exp(-((x - fx) / (r * 1.9)) ** 2)
            y = mix(mix(0.14, 0.86, mid) * css_h, fy + (mid - 0.5) * r * 1.6, pull)
            y += css_h * 0.06 * math.sin(x / css_w * 6.283 * (0.6 + 0.5 * rnd(hs)) + 6.283 * rnd(hs ^ 7) + t * 0.09) \
                * (1 - 0.7 * pull)
            spread = r2 * 2 - 1
            y += spread * abs(spread) * mix(css_h * 0.022, r * 0.1, pull)
            px, py = mix(x, ax, e) * self.dpr, mix(y, ay, e) * self.dpr
            edge = smoothstep(-m, 0, x) * smoothstep(css_w + m, css_w, x)
            lit = max(az, 0.0)
            shimmer = 0.82 + 0.18 * self.vnoise(ax / 14 + t * 0.5, ay / 14 - t * 0.35)
            stream = (0.62 if gathers else 0.4 + 0.32 * r3) * edge
            alpha = mix(stream, shimmer, e) * self.keep(px, py) * self.fade_out(py)
            if alpha < 0.004:
                continue
            rgb = tuple(mix(self.colors['ink'][k], ramp(self.colors['ramp'], lit)[k], e) for k in range(3))
            dot(px, py, rgb, alpha, mix(1.5, self.cell * mix(0.55, 1.0, lit), e) * self.dpr, e > 0.5)


def text_width(text, size, tracking):
    """A slightly wide guess at how long a line of type runs, so it holds for any font in the stack."""
    em = sum(0.3 if ch in 'fijlrt .,:;!-' else 0.86 if ch in 'mwMW' else 0.68 if ch.isupper() else 0.57 for ch in text)
    return (em + tracking * len(text)) * size


def text_block(lines, w, dpr, pad=20, reach=True):
    """The box around the type, measured the way the site measures its banner text: around every line, padded by
    pad site px, and (with reach) past the left and top edges when the type starts near them, so the whole left side
    stays calm."""
    left = min(x for x, _, _, _, _ in lines)
    top = min(base - 0.95 * size for _, base, size, _, _ in lines)
    right = max(x + text_width(text, size, track) for x, _, size, text, track in lines)
    bottom = max(base + 0.3 * size for _, base, size, _, _ in lines)
    if reach and left < w * 0.25:
        left = -400 * dpr
    if reach and top < 160 * dpr:
        top = -400 * dpr
    pad *= dpr
    return (left - pad, top - pad, right + pad, bottom + pad)


def dots_path(points, width):
    """One short stroke per point, as long as the stroke is wide (butt ends), in half px: a square in every browser.
    (A zero-length stroke with square caps would be shorter, but WebKit draws those round.)"""
    out, last = [], None
    for x, y in sorted({(round(x * 2), round(y * 2)) for x, y in points}, key=lambda p: (p[1], p[0])):
        if last is None:
            out.append(f'M{x - width / 2:g} {y}h{width}')
        else:
            dx, dy = x - last[0] - width, y - last[1]
            out.append(f'm{dx}{"" if dy < 0 else " "}{dy}h{width}')
        last = (x, y)
    return ''.join(out)


def strength(alpha):
    """Opacity in 16 steps that are finer where it's faint, or None when it would barely show."""
    q = round(math.sqrt(alpha) * 16)
    return (q / 16) ** 2 if q >= 2 else None


def poster_svg(spec, scheme):
    card = CARD[scheme]
    (w, h), dpr, radius = spec['size'], spec['dpr'], spec['radius']
    lx, ly, ls = spec['label']
    nx, ny1, ny2, ns = spec['name']
    line = spec.get('line')
    lines = [(lx, ly, ls, LABEL, -0.01), (nx, ny1, ns, NAME[0], -0.035), (nx, ny2, ns, NAME[1], -0.035)]
    # The field dims behind the label and title, as behind the site's banner text. The line at the bottom gets the
    # site's other treatment, a clear patch of plain ground just around it, so the dimming doesn't reach the form.
    clear = None
    if line:
        tx, ty, ts = line
        clear = text_block([(tx, ty, ts, LINE, -0.01)], w, dpr, pad=12, reach=False)
    swarm = Swarm(w, h, dpr, scheme, text_block(lines, w, dpr), clear)

    # Points that look alike share one path: the form's cells by their light (color and size) and strength, the
    # streams by strength. The form goes down first, as on the site.
    groups = {}

    def dot(x, y, rgb, alpha, size, in_form):
        a = strength(alpha)
        if a is not None and -size < x < w + size and -size < y < h + size:
            groups.setdefault((0 if in_form else 1, hex_color(rgb), js_round(size * 2), a), []).append((x, y))

    swarm.draw(dot)
    paths = '\n'.join(f'<path stroke="{color}" stroke-opacity="{a:.3g}" stroke-width="{width}" '
                      f'd="{dots_path(pts, width)}"/>' for (_, color, width, a), pts in sorted(groups.items()))

    frame = f'<clipPath id="frame"><rect width="{w}" height="{h}" rx="{radius}"/></clipPath>\n' if radius else ''
    # A hairline just inside the edge, so the card holds its shape on a page the same color as its ground.
    color, opacity = card['edge']
    edge = (f'<rect x="0.75" y="0.75" width="{w - 1.5}" height="{h - 1.5}" rx="{radius - 0.75}" fill="none" '
            f'stroke="{color}" stroke-opacity="{opacity:g}" stroke-width="1.5"/>\n' if radius else '')
    desc = f'<desc id="desc">{LINE}</desc>\n' if line else ''
    line_style = (f'.line {{ font-size: {ts}px; font-weight: 500; letter-spacing: -0.01em; fill: {card["type"]}; }}\n'
                  if line else '')
    line_text = f'<text class="line" x="{tx}" y="{ty}">{LINE}</text>\n' if line else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title{' desc' if line else ''}">
<title id="title">Autonomous output skills</title>
{desc}<style>
text {{ font-family: {FONT}; text-rendering: geometricPrecision; }}
.label {{ font-size: {ls}px; font-weight: 500; letter-spacing: -0.01em; fill: {card['label']}; }}
.name {{ font-size: {ns}px; font-weight: 560; letter-spacing: -0.035em; fill: {card['type']}; }}
{line_style}</style>
{frame}<g{' clip-path="url(#frame)"' if radius else ''}>
<rect width="{w}" height="{h}" fill="{card['ground']}"/>
<g transform="scale(.5)" fill="none">
{paths}
</g>
</g>
{edge}<text class="label" x="{lx}" y="{ly}">{LABEL}</text>
<text class="name" x="{nx}" y="{ny1}">{NAME[0]}</text>
<text class="name" x="{nx}" y="{ny2}">{NAME[1]}</text>
{line_text}</svg>
'''


def wave(u, v):
    """Two slow waves across a box (u and v run 0 to 1), so the dither's edge rolls a little instead of running
    straight."""
    return 0.07 * math.sin(u * 5.1) * math.cos(v * 4.3) + 0.04 * math.sin((u + v) * 7.7)


def cells_path(on, size, offset=(0, 0)):
    """One SVG path for the cells that are on: runs across a row, stacked while the next rows repeat them."""
    rects, open_runs = [], {}
    for r, row in enumerate(on):
        seen, c, n = set(), 0, len(row)
        while c < n:
            if not row[c]:
                c += 1
                continue
            start = c
            while c < n and row[c]:
                c += 1
            key = (start, c - start)
            seen.add(key)
            if key in open_runs:
                open_runs[key][1] += 1
            else:
                open_runs[key] = [r, 1]
        for key in [k for k in open_runs if k not in seen]:
            rects.append((key, *open_runs.pop(key)))
    rects += [(k, *v) for k, v in open_runs.items()]
    rects.sort(key=lambda t: (t[1], t[0][0]))
    ox, oy = offset
    return ''.join(f'M{ox + s * size} {oy + r0 * size}h{n * size}v{rows * size}h{-n * size}z'
                   for (s, n), r0, rows in rects)


def dither_layers(strength_at, cols, rows, cell, stops, offset=(0, 0)):
    """The cells an ordered dither turns on, as SVG paths, one per color (a cell's color follows the light's strength
    there). Edges are crisp, like pixels: no hairline of ground between neighbors of different colors at any scale."""
    groups = {}
    for r in range(rows):
        for c in range(cols):
            s = strength_at(c, r)
            if s is not None and s * 64 > BAYER[r % 8][c % 8] + 0.5:
                key = round((0.3 + 0.7 * min(1.0, s)) * 255)
                groups.setdefault(key, [[False] * cols for _ in range(rows)])[r][c] = True
    paths = [f'<path fill="{shade(stops, key / 255)}" d="{cells_path(groups[key], cell, offset)}"/>'
             for key in sorted(groups)]
    return '<g shape-rendering="crispEdges">\n' + '\n'.join(paths) + '\n</g>'


def qr_matrix(svg_text):
    """The modules of repo-qr.svg (a path of horizontal runs, one row per y), as rows of booleans without margins."""
    size = int(re.search(r'viewBox="0 0 (\d+) \d+"', svg_text).group(1))
    grid = [[False] * size for _ in range(size)]
    x = y = 0.0
    path = re.search(r' d="([^"]+)"', svg_text).group(1)
    for cmd, a, b in re.findall(r'([Mmh])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?', path):
        if cmd == 'M':
            x, y = float(a), float(b)
        elif cmd == 'm':
            x, y = x + float(a), y + float(b)
        else:
            for c in range(int(x), int(x + float(a))):
                grid[int(y)][c] = True
            x += float(a)
    rows = [r for r in range(size) if any(grid[r])]
    cols = [c for c in range(size) if any(grid[r][c] for r in range(size))]
    return [row[cols[0]:cols[-1] + 1] for row in grid[rows[0]:rows[-1] + 1]]


def qr_svg(matrix):
    """The code, dark on the dither's light: a square of it the size of the code and its quiet zone (four modules,
    solid, as scanners need), dissolving into the ground on every side, farthest toward the bottom right. The
    dither's cells are half a module, so the code stays the boldest thing."""
    n, module, quiet, band, cell = len(matrix), 8, 4, 8, 4
    core = (n + 2 * quiet) * module
    pad = band * module
    size = core + 2 * pad
    a, b = pad, pad + core

    def strength(c, r):
        x, y = (c + 0.5) * cell, (r + 0.5) * cell
        if a <= x < b and a <= y < b:
            return None
        dist = math.hypot(max(a - x, 0, x - b), max(a - y, 0, y - b))
        reach = pad * (0.7 + 0.45 * (x + y) / (2 * size))
        return 1 - dist / reach + 0.5 * wave(x / size, y / size)

    cells = dither_layers(strength, size // cell, size // cell, cell, DITHER)
    modules = cells_path(matrix, module, (a + quiet * module, a + quiet * module))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-labelledby="title">
<title id="title">QR code for {URL.split('://')[1]}</title>
<clipPath id="frame"><rect width="{size}" height="{size}" rx="{2 * module}"/></clipPath>
<g clip-path="url(#frame)">
<rect width="{size}" height="{size}" fill="{CARD['dark']['ground']}"/>
{cells}
<g shape-rendering="crispEdges">
<rect x="{a}" y="{a}" width="{core}" height="{core}" fill="{shade(DITHER, 1)}"/>
<path fill="{CARD['dark']['ground']}" d="{modules}"/>
</g>
</g>
</svg>
'''


def find_chrome():
    places = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    ]
    for place in places:
        if Path(place).is_file():
            return place
    # A snap browser (Ubuntu's chromium) has its own /tmp and can't read hidden folders, so it can't open the page.
    snap = Path('/snap/bin/chromium').exists()
    for name in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge'):
        found = shutil.which(name)
        if found and not os.path.realpath(found).startswith('/snap/') and not (snap and name == 'chromium-browser'):
            return found
    for cache in (Path.home() / 'Library/Caches/ms-playwright', Path.home() / '.cache/ms-playwright',
                  Path.home() / 'AppData/Local/ms-playwright'):
        for pattern in ('chromium-*/chrome-mac*/*.app/Contents/MacOS/*', 'chromium-*/chrome-linux*/chrome',
                        'chromium-*/chrome-win*/chrome.exe'):
            found = sorted(cache.glob(pattern))
            if found:
                return str(found[-1])
    return None


def save_png(chrome, svg, png, width, height, scale):
    """A screenshot of the SVG shown as an image, the way GitHub shows it, from a throwaway profile."""
    tmp = Path(tempfile.mkdtemp(prefix='repo-imagery-'))
    try:
        page = tmp / 'page.html'
        page.write_text('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}'
                        f'img{{display:block}}</style><img src="{svg.resolve().as_uri()}" width="{width}" '
                        f'height="{height}">', encoding='utf-8')
        command = [chrome, '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
                   '--no-default-browser-check', f'--user-data-dir={tmp / "profile"}',
                   f'--force-device-scale-factor={scale}', f'--window-size={width},{height}',
                   '--default-background-color=00000000', f'--screenshot={png.resolve()}', page.as_uri()]
        if png.exists():
            png.unlink()
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        if result.returncode or not png.is_file():
            raise SystemExit(f'error: could not save {png.name}: {result.stderr.strip()[-300:]}')
    finally:
        # Chrome's helper processes can hold files in the profile for a moment after it exits, and Windows won't
        # delete open files: try a few times, and never fail the run over a leftover temporary folder.
        for _ in range(10):
            shutil.rmtree(tmp, ignore_errors=True)
            if not tmp.exists():
                break
            time.sleep(0.5)


def decode_qr(png):
    try:
        import zxingcpp
        from PIL import Image
        found = zxingcpp.read_barcodes(Image.open(png))
        return 'zxing-cpp', found[0].text if found else ''
    except ImportError:
        pass
    try:
        import cv2
        text, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(str(png)))
        return 'OpenCV', text
    except ImportError:
        return None, ''


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--png', metavar='DIR', help='also save PNGs here (1x and 2x; the social preview at 1280 by 640)')
    args = parser.parse_args()

    qr = qr_svg(qr_matrix((HERE / 'repo-qr.svg').read_text(encoding='utf-8')))
    qr_size = int(re.search(r'width="(\d+)"', qr).group(1))
    files = {
        'repo-hero-dark.svg': (poster_svg(HERO, 'dark'), HERO['size']),
        'repo-hero-light.svg': (poster_svg(HERO, 'light'), HERO['size']),
        'repo-social-preview.svg': (poster_svg(SOCIAL, 'dark'), SOCIAL['size']),
        'repo-qr-dither.svg': (qr, (qr_size, qr_size)),
    }
    for name, (text, _) in files.items():
        with open(HERE / name, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        print(f'wrote {name} ({len(text.encode("utf-8")) // 1024} KB)')
    if not args.png:
        return 0

    chrome = find_chrome()
    if not chrome:
        print("error: --png needs Chrome, Edge or Chromium (or Playwright's Chromium)", file=sys.stderr)
        return 1
    out = Path(args.png).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    for name, (_, (width, height)) in files.items():
        for scale in ((1,) if name == 'repo-social-preview.svg' else (1, 2)):
            png = out / (Path(name).stem + ('' if scale == 1 else f'@{scale}x') + '.png')
            save_png(chrome, HERE / name, png, width, height, scale)
            print(f'saved {png}')
    tool, text = decode_qr(out / 'repo-qr-dither.png')
    if tool is None:
        print('note: pip install zxing-cpp pillow (or opencv-python) to check that the QR code decodes')
    elif text != URL:
        print(f'error: {tool} read {text!r} from repo-qr-dither.png, not {URL}', file=sys.stderr)
        return 1
    else:
        print(f'checked: {tool} reads {URL} from repo-qr-dither.png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
