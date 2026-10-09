#!/usr/bin/env python3
"""Contact sheet for reviewing a recording before delivery.

Samples evenly spaced frames (or explicit times) from an MP4 and tiles them with timestamps, so a
reviewer can scan the whole take for toasts, tooltips, wrong themes, stale sessions, clipped menus,
and missing beats in one image. Contact sheets can miss overlays that last only 2 to 3 seconds, so
also pass --times around every hover, menu, and transition (or use --every for a dense pass).

Usage: contact-sheet.py <video.mp4> [--count 12] [--times 3.5,10,41.2] [--every 0.5 --start 40 --end 46]
                        [--columns 3] [--tile-width 640] [--out contact-sheet.jpg]
Requires ffmpeg on PATH and Pillow.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('video')
parser.add_argument('--count', type=int, default=12)
parser.add_argument('--times', help='comma separated seconds')
parser.add_argument('--every', type=float, help='sample every N seconds between --start and --end')
parser.add_argument('--start', type=float, default=0.0)
parser.add_argument('--end', type=float)
parser.add_argument('--columns', type=int, default=3)
parser.add_argument('--tile-width', type=int, default=640)
parser.add_argument('--out')
args = parser.parse_args()

if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
    sys.exit('ffmpeg/ffprobe not found on PATH')

video = Path(args.video).resolve()
duration = float(json.loads(subprocess.run(
    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(video)],
    capture_output=True, text=True, check=True).stdout)['format']['duration'])

if args.times:
    times = [float(t) for t in args.times.split(',') if t.strip()]
elif args.every:
    end = args.end if args.end is not None else duration
    times, t = [], args.start
    while t <= end + 1e-6:
        times.append(round(t, 3))
        t += args.every
else:
    count = max(2, args.count)
    times = [min(duration - 0.05, duration * i / (count - 1)) for i in range(count)]
times = [max(0.0, min(t, max(0.0, duration - 0.05))) for t in times]

try:
    font = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', 18)
except OSError:
    font = ImageFont.load_default()

tiles = []
with tempfile.TemporaryDirectory() as work:
    for index, t in enumerate(times):
        frame = Path(work) / f'{index:04d}.png'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', str(video), '-frames:v', '1', str(frame)], check=True)
        image = Image.open(frame).convert('RGB')
        image.thumbnail((args.tile_width, args.tile_width * 2))
        tile = Image.new('RGB', (args.tile_width, image.height + 28), (246, 246, 246))
        tile.paste(image, (0, 0))
        ImageDraw.Draw(tile).text((10, image.height + 5), f'{t:.1f}s', fill=(40, 40, 40), font=font)
        tiles.append(tile)

columns = max(1, args.columns)
rows = (len(tiles) + columns - 1) // columns
tile_height = max(tile.height for tile in tiles)
sheet = Image.new('RGB', (columns * args.tile_width, rows * tile_height), (246, 246, 246))
for index, tile in enumerate(tiles):
    sheet.paste(tile, ((index % columns) * args.tile_width, (index // columns) * tile_height))
out = Path(args.out) if args.out else video.with_name(video.stem + '-contact-sheet.jpg')
sheet.save(out, quality=90)
print(json.dumps({'sheet': str(out), 'duration': round(duration, 2), 'times': times}))
