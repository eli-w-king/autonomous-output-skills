#!/usr/bin/env python3
"""Join demo takes into one master with a title card before each take, so every variant, phase,
plan, or design in a multi-part demo is clearly labeled (for example "Design A, segmented" or
"Free plan"). Cards fade in and out; takes get short fades at their edges. Every part is
normalized to one size and frame rate before joining.

Usage:
  title-cards.py <out.mp4> --card "Title|Subtitle" take1.mp4 --card "Title 2|Subtitle" take2.mp4 ...
                 [--size 1920x1200] [--theme dark|light] [--card-seconds 3] [--no-take-fades]

A take with no --card before it is appended without a card. Card PNGs are also written next to the
output (title-card-N.png) for the stills folder. Requires ffmpeg, ffprobe, and Pillow.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
parser.add_argument('out')
parser.add_argument('--size', default='1920x1200')
parser.add_argument('--theme', choices=['dark', 'light'], default='dark')
parser.add_argument('--card-seconds', type=float, default=3.0)
parser.add_argument('--no-take-fades', action='store_true')
args, rest = parser.parse_known_args()

if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
    sys.exit('ffmpeg/ffprobe not found on PATH')

width, height = (int(v) for v in args.size.split('x'))
items = []
pending = None
index = 0
while index < len(rest):
    token = rest[index]
    if token == '--card':
        pending = rest[index + 1]
        index += 2
        continue
    items.append((pending, Path(token).resolve()))
    pending = None
    index += 1
if not items:
    sys.exit('no takes given')
for _, take in items:
    if not take.exists():
        sys.exit(f'missing take: {take}')

background, title_color, subtitle_color = ((18, 20, 21), (236, 236, 236), (150, 154, 158)) if args.theme == 'dark' \
    else ((246, 246, 246), (28, 28, 28), (96, 100, 104))


def font(size):
    for candidate in ('/System/Library/Fonts/SFNS.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_card(path, text):
    title, _, subtitle = text.partition('|')
    image = Image.new('RGB', (width, height), background)
    draw = ImageDraw.Draw(image)
    title_font, subtitle_font = font(int(height * 0.063)), font(int(height * 0.03))
    title_box = draw.textbbox((0, 0), title, font=title_font)
    subtitle_box = draw.textbbox((0, 0), subtitle or ' ', font=subtitle_font)
    title_height = title_box[3] - title_box[1]
    gap = int(height * 0.028) if subtitle else 0
    block = title_height + gap + (subtitle_box[3] - subtitle_box[1] if subtitle else 0)
    top = (height - block) / 2
    draw.text(((width - (title_box[2] - title_box[0])) / 2, top - title_box[1]), title, font=title_font, fill=title_color)
    if subtitle:
        draw.text(((width - (subtitle_box[2] - subtitle_box[0])) / 2, top + title_height + gap - subtitle_box[1]), subtitle,
                  font=subtitle_font, fill=subtitle_color)
    image.save(path)


def duration_of(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                                capture_output=True, text=True, check=True).stdout)


normalize = f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x{background[0]:02x}{background[1]:02x}{background[2]:02x},fps=30'
out = Path(args.out).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as temp:
    work = Path(temp)
    parts = []
    card_count = 0
    for number, (card_text, take) in enumerate(items):
        if card_text:
            card_count += 1
            png = work / f'card-{card_count}.png'
            draw_card(png, card_text)
            shutil.copy(png, out.parent / f'title-card-{card_count}.png')
            part = work / f'part-{len(parts):03d}.mp4'
            seconds = args.card_seconds
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-t', str(seconds), '-i', str(png),
                            '-vf', f'{normalize},fade=t=in:st=0:d=0.4,fade=t=out:st={seconds - 0.4}:d=0.4,format=yuv420p',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-an', str(part)], check=True)
            parts.append(part)
        part = work / f'part-{len(parts):03d}.mp4'
        fades = '' if args.no_take_fades else f',fade=t=in:st=0:d=0.4,fade=t=out:st={max(0.0, duration_of(take) - 0.5)}:d=0.5'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(take), '-vf', f'{normalize}{fades},format=yuv420p',
                        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-an', str(part)], check=True)
        parts.append(part)
    listing = work / 'parts.txt'
    listing.write_text(''.join(f"file '{part}'\n" for part in parts))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c', 'copy',
                    '-movflags', '+faststart', str(out)], check=True)

info = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', str(out)],
                                 capture_output=True, text=True, check=True).stdout)
print(json.dumps({'out': str(out), 'cards': card_count, 'takes': len(items), **info}))
