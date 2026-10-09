#!/usr/bin/env node
// In-place speed ramps: keep one continuous take, but fast-forward the idle waiting (agents
// working, builds, CI) so the video stays watchable. Interaction segments stay at 1x. Nothing is
// cut, so the viewer never loses the thread and nothing looks spliced.
//
// Usage:
//   node speed-ramp.mjs <in.mp4> <out.mp4> [--marks frames.json] [--idle fromMark:toMark[@speed]]...
//                       [--range fromSec:toSec[@speed]]... [--speed 10] [--crf 18] [--fps 30]
//
// Examples:
//   node speed-ramp.mjs take.mp4 demo.mp4 --marks frames/frames.json \
//     --idle wait_attempts_start:judge_appeared --idle wait_verdict_start:verdict_appeared@12
//   node speed-ramp.mjs take.mp4 demo.mp4 --range 48.2:572.1@18
//
// Marks come from demo-driver.mjs (/mark), and their `video` time is the time on the encoded take.
// Leave a second or two of real-time motion on both sides of every ramp so the change reads.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const [input, output] = argv;
if (!input || !output || input.startsWith('--')) {
	console.error('usage: node speed-ramp.mjs <in.mp4> <out.mp4> [--marks frames.json] [--idle from:to[@speed]] [--range a:b[@speed]] [--speed 10]');
	process.exit(2);
}
const values = name => argv.flatMap((value, index) => value === `--${name}` ? [argv[index + 1]] : []);
const one = (name, fallback) => values(name)[0] ?? fallback;
const defaultSpeed = Number(one('speed', '10'));
const crf = one('crf', '18');
const fps = one('fps', '30');

const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file]).toString());
const total = Number(probe(input).format.duration);

const marks = {};
const marksFile = one('marks');
if (marksFile) {
	const data = JSON.parse(fs.readFileSync(marksFile, 'utf8'));
	for (const mark of Array.isArray(data) ? data : data.marks ?? []) {
		marks[mark.name] = mark.video ?? mark.t;
	}
}
const parseSpec = (spec, resolve) => {
	const [span, speed] = spec.split('@');
	const [from, to] = span.split(':').map(resolve);
	return { from, to, speed: speed ? Number(speed) : defaultSpeed, spec };
};
const ranges = [
	...values('idle').map(spec => parseSpec(spec, name => {
		if (!(name in marks)) {
			throw new Error(`unknown mark ${name}. Known: ${Object.keys(marks).join(', ') || '(none, pass --marks)'}`);
		}
		return marks[name];
	})),
	...values('range').map(spec => parseSpec(spec, Number)),
].map(r => ({ ...r, from: Math.max(0, r.from), to: Math.min(total, r.to) }))
	.filter(r => r.to - r.from > 0.1 && r.speed > 1)
	.sort((a, b) => a.from - b.from);

for (let index = 1; index < ranges.length; index++) {
	if (ranges[index].from < ranges[index - 1].to) {
		throw new Error(`ranges overlap: ${ranges[index - 1].spec} and ${ranges[index].spec}`);
	}
}
if (!ranges.length) {
	throw new Error('no idle ranges given (use --idle with --marks, or --range)');
}

const points = [...new Set([0, total, ...ranges.flatMap(r => [r.from, r.to])])].sort((a, b) => a - b);
const segments = [];
for (let index = 0; index < points.length - 1; index++) {
	const [start, end] = [points[index], points[index + 1]];
	if (end - start < 0.05) {
		continue;
	}
	const ramp = ranges.find(r => start >= r.from - 0.01 && end <= r.to + 0.01);
	segments.push({ start, end, speed: ramp ? ramp.speed : 1 });
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-ramp-'));
const parts = segments.map((segment, index) => {
	const part = path.join(work, `part-${String(index).padStart(3, '0')}.mp4`);
	const pts = segment.speed === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${segment.speed}`;
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(segment.start), '-to', String(segment.end), '-i', input,
		'-vf', `setpts=${pts},fps=${fps},format=yuv420p`, '-an',
		'-c:v', 'libx264', '-preset', 'medium', '-crf', crf, part]);
	return part;
});
const list = path.join(work, 'list.txt');
fs.writeFileSync(list, parts.map(part => `file '${part}'`).join('\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
	'-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', output]);
fs.rmSync(work, { recursive: true, force: true });

const result = probe(output);
console.log(JSON.stringify({
	output,
	inputSeconds: +total.toFixed(2),
	outputSeconds: +Number(result.format.duration).toFixed(2),
	size: `${result.streams[0].width}x${result.streams[0].height}`,
	segments: segments.map(s => ({ from: +s.start.toFixed(2), to: +s.end.toFixed(2), speed: s.speed })),
}, null, 1));
