#!/usr/bin/env python3
"""Encode a CDP screencast capture (frames.json + JPEG frames from demo-driver.mjs) into an MP4.

CDP screencast frames arrive only when the page repaints (about 2 fps for a still scene, 30+ for a
spinner), so every frame is held until the next frame's timestamp and the result is resampled to a
constant frame rate. The video timeline starts at the first frame, which is the same origin as the
`video` time of each mark in frames.json.

Usage: encode-screencast.py <frames-dir> <out.mp4> [--width 1920] [--fps 30] [--crf 16]
                            [--hold-end 0] [--square]

--square center-crops to a square before scaling (for square storyboard recordings, record a
square viewport instead whenever you can).
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('frames_dir')
parser.add_argument('out')
parser.add_argument('--width', type=int, default=1920)
parser.add_argument('--fps', type=int, default=30)
parser.add_argument('--crf', type=int, default=16)
parser.add_argument('--hold-end', type=float, default=0.0, help='extra seconds to hold the last frame')
parser.add_argument('--square', action='store_true')
args = parser.parse_args()

for tool in ('ffmpeg', 'ffprobe'):
    if not shutil.which(tool):
        sys.exit(f'{tool} not found on PATH (macOS: export PATH="/opt/homebrew/bin:$PATH")')

frames_dir = Path(args.frames_dir).resolve()
out = Path(args.out).resolve()
meta = json.loads((frames_dir / 'frames.json').read_text())
frames = sorted(meta['frames'], key=lambda frame: frame['t'])
if not frames:
    sys.exit('no frames captured')

end_of_capture = max(meta.get('stoppedAt', frames[-1]['t']), frames[-1]['t'])
lines = ['ffconcat version 1.0']
for index, frame in enumerate(frames):
    end = frames[index + 1]['t'] if index + 1 < len(frames) else end_of_capture + args.hold_end
    duration = max(end - frame['t'], 1 / 240)
    lines.append(f"file '{frames_dir / frame['file']}'")
    lines.append(f'duration {duration:.4f}')
# The concat demuxer ignores the last entry's duration unless the file is repeated.
lines.append(f"file '{frames_dir / frames[-1]['file']}'")
listing = frames_dir / 'concat.txt'
listing.write_text('\n'.join(lines) + '\n')

filters = []
if args.square:
    filters.append("crop='min(iw,ih)':'min(iw,ih)'")
# Screencast JPEGs are full range; without out_range=tv the MP4 comes out as yuvj420p.
filters += [f'scale={args.width}:-2:flags=lanczos:out_range=tv', f'fps={args.fps}', 'format=yuv420p']
out.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([
    'ffmpeg', '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', str(listing),
    '-vf', ','.join(filters),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', str(args.crf), '-profile:v', 'high',
    '-movflags', '+faststart', '-an',
    str(out),
], check=True)

probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                        'format=duration:stream=width,height,nb_frames,codec_name,pix_fmt', '-of', 'json', str(out)],
                       capture_output=True, text=True, check=True)
info = json.loads(probe.stdout)
print(json.dumps({
    'out': str(out),
    'frames_in': len(frames),
    'captured_seconds': round(end_of_capture - frames[0]['t'], 2),
    'marks': meta.get('marks', []),
    **info,
}, indent=1))
