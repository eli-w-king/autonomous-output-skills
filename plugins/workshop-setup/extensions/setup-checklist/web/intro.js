// The opening: a field of blue ASCII that dithers in, gathers into the host's name, then hands over to the
// checklist. A 2D canvas text grid at 30 frames a second, paused while the page is hidden. SetupIntro.still draws one
// calm frame for the header band (and for reduced motion).
(function () {
	'use strict';

	const RAMP = ' .:-=+*#%@';
	const LEVELS = 8;
	const CELL_W = 8;
	const CELL_H = 14;
	const FRAME_MS = 1000 / 30;
	const T = { boot: 900, gather: 1500, resolve: 1200, hold: 1000, out: 500 };
	const END = T.boot + T.gather + T.resolve + T.hold + T.out;
	const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
		3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => (v + 0.5) / 64);
	const MONO = '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
	const SCRAMBLE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%*+=';

	const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
	const mix = (a, b, t) => Math.round(a + (b - a) * t);

	function palette(dark) {
		return dark
			? { bg: '#05080d', lo: [18, 52, 120], hi: [150, 205, 255] }
			: { bg: '#f4f7fb', lo: [170, 196, 236], hi: [0, 92, 184] };
	}

	// Glyphs pre-drawn per brightness level, so a frame is one drawImage per cell.
	function makeAtlas(colors, dpr, cellW, cellH) {
		const atlas = document.createElement('canvas');
		atlas.width = RAMP.length * cellW * dpr;
		atlas.height = LEVELS * cellH * dpr;
		const ctx = atlas.getContext('2d');
		ctx.scale(dpr, dpr);
		ctx.font = MONO;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		for (let level = 0; level < LEVELS; level++) {
			const t = level / (LEVELS - 1);
			ctx.fillStyle = `rgb(${mix(colors.lo[0], colors.hi[0], t)}, ${mix(colors.lo[1], colors.hi[1], t)}, ${mix(colors.lo[2], colors.hi[2], t)})`;
			for (let g = 1; g < RAMP.length; g++) {
				ctx.fillText(RAMP[g], g * cellW + cellW / 2, level * cellH + cellH / 2 + 0.5);
			}
		}
		return atlas;
	}

	function grid(canvas, cellW, cellH) {
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const w = Math.max(1, canvas.clientWidth);
		const h = Math.max(1, canvas.clientHeight);
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		const cols = Math.ceil(w / cellW);
		const rows = Math.ceil(h / cellH);
		const rand = new Float32Array(cols * rows);
		let seed = 7;
		for (let i = 0; i < rand.length; i++) {
			seed = (seed * 16807) % 2147483647;
			rand[i] = seed / 2147483647;
		}
		return { dpr, w, h, cols, rows, rand };
	}

	// How much of each cell the name covers, from the name's real position on the page.
	function nameMask(g, el, offsetTop, offsetLeft) {
		const mask = new Float32Array(g.cols * g.rows);
		if (!el || !el.textContent) {
			return mask;
		}
		const rect = el.getBoundingClientRect();
		const style = getComputedStyle(el);
		const big = document.createElement('canvas');
		big.width = g.cols * CELL_W;
		big.height = g.rows * CELL_H;
		const ctx = big.getContext('2d');
		ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#fff';
		ctx.fillText(el.textContent, rect.left - offsetLeft + rect.width / 2, rect.top - offsetTop + rect.height / 2);
		const small = document.createElement('canvas');
		small.width = g.cols;
		small.height = g.rows;
		const sctx = small.getContext('2d');
		sctx.imageSmoothingQuality = 'high';
		sctx.drawImage(big, 0, 0, g.cols, g.rows);
		const data = sctx.getImageData(0, 0, g.cols, g.rows).data;
		for (let i = 0; i < mask.length; i++) {
			mask[i] = Math.min(1, (data[i * 4 + 3] / 255) * 1.6);
		}
		return mask;
	}

	function fieldAt(g, x, y, t, cy) {
		const nx = (x + 0.5) / g.cols - 0.5;
		const ny = ((y + 0.5) / g.rows - cy) * (g.h / g.w);
		const breath = 1 + 0.05 * Math.sin((t / 2400) * Math.PI * 2);
		const r = Math.sqrt(nx * nx + ny * ny) / (0.42 * breath);
		const ripple = 0.78 + 0.22 * Math.sin(x * 0.31 + t * 0.0021) * Math.sin(y * 0.47 - t * 0.0017);
		return Math.exp(-r * r) * ripple;
	}

	function drawCells(ctx, g, atlas, levelOf) {
		ctx.clearRect(0, 0, g.w, g.h);
		const sw = CELL_W * g.dpr;
		const sh = CELL_H * g.dpr;
		for (let y = 0; y < g.rows; y++) {
			for (let x = 0; x < g.cols; x++) {
				const cell = levelOf(x, y, y * g.cols + x);
				if (!cell) {
					continue;
				}
				ctx.drawImage(atlas, cell.glyph * sw, cell.level * sh, sw, sh, x * CELL_W, y * CELL_H, CELL_W, CELL_H);
			}
		}
	}

	// Ordered dithering: brightness plus the Bayer threshold picks the glyph and its color level.
	function quantize(intensity, threshold) {
		const v = intensity * (RAMP.length - 1) + (threshold - 0.5);
		const glyph = Math.max(0, Math.min(RAMP.length - 1, Math.round(v)));
		if (!glyph) {
			return null;
		}
		const level = Math.max(0, Math.min(LEVELS - 1, Math.round(intensity * (LEVELS - 1) + (threshold - 0.5) * 0.6)));
		return { glyph, level };
	}

	function decode(el, text, startMs, durationMs, now) {
		const p = smooth((now - startMs) / durationMs);
		if (p <= 0) {
			el.textContent = '';
			return;
		}
		const settled = Math.floor(text.length * p);
		let out = text.slice(0, settled);
		for (let i = settled; i < Math.min(text.length, settled + 4); i++) {
			out += text[i] === ' ' ? ' ' : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
		}
		el.textContent = out;
	}

	// Long names (two hosts, say) shrink to fit on one line, so the ASCII gathers exactly where the name resolves.
	function fitName(el, maxWidth) {
		el.style.fontSize = '';
		const width = el.scrollWidth;
		if (maxWidth > 0 && width > maxWidth) {
			const size = parseFloat(getComputedStyle(el).fontSize);
			el.style.fontSize = `${Math.max(14, Math.floor((size * maxWidth) / width))}px`;
		}
	}

	function play(root, { name, lines = [], dark = true } = {}) {
		return new Promise((resolve) => {
			const field = root.querySelector('.intro-field');
			const glow = root.querySelector('.intro-glow');
			const box = root.querySelector('.intro-lines');
			const skip = root.querySelector('.intro-skip');
			box.textContent = '';
			const nameEl = document.createElement('p');
			nameEl.className = 'intro-name';
			nameEl.textContent = name;
			box.append(nameEl);
			const lineEls = lines.map((text, i) => {
				const p = document.createElement('p');
				p.className = i === 0 && lines.length > 1 ? 'intro-sub' : 'intro-title';
				p.dataset.text = text;
				box.append(p);
				return p;
			});
			root.hidden = false;
			root.classList.toggle('is-light', !dark);
			fitName(nameEl, root.clientWidth - 64);
			const colors = palette(dark);
			const g = grid(field, CELL_W, CELL_H);
			const ctx = field.getContext('2d');
			ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
			const atlas = makeAtlas(colors, g.dpr, CELL_W, CELL_H);
			const rootRect = root.getBoundingClientRect();
			const mask = nameMask(g, nameEl, rootRect.top, rootRect.left);
			const cy = Math.min(0.62, Math.max(0.3, (nameEl.getBoundingClientRect().top + nameEl.offsetHeight / 2 - rootRect.top) / Math.max(1, g.h)));
			glow.width = Math.max(1, Math.round(g.cols / 2));
			glow.height = Math.max(1, Math.round(g.rows / 2));
			const gctx = glow.getContext('2d');

			let elapsed = 0;
			let last = null;
			let raf = 0;
			let done = false;

			const finish = () => {
				if (done) {
					return;
				}
				done = true;
				cancelAnimationFrame(raf);
				document.removeEventListener('visibilitychange', onVisibility);
				root.removeEventListener('pointerdown', finish);
				window.removeEventListener('keydown', finish, true);
				root.hidden = true;
				resolve();
			};

			const frame = (now) => {
				if (done) {
					return;
				}
				if (last !== null) {
					const step = now - last;
					if (step < FRAME_MS - 2) {
						raf = requestAnimationFrame(frame);
						return;
					}
					elapsed += Math.min(step, 100);
				}
				last = now;
				render(elapsed);
				if (elapsed >= END) {
					finish();
					return;
				}
				raf = requestAnimationFrame(frame);
			};

			const render = (t) => {
				const a = T.boot;
				const b = a + T.gather;
				const c = b + T.resolve;
				const d = c + T.hold;
				const reveal = smooth(t / T.boot);
				const gather = smooth((t - a) / T.gather);
				const resolveP = smooth((t - b) / T.resolve);
				const out = smooth((t - d) / T.out);
				drawCells(ctx, g, atlas, (x, y, i) => {
					const threshold = BAYER[(y & 7) * 8 + (x & 7)];
					if (out > 0 && threshold < out) {
						return null;
					}
					const f = fieldAt(g, x, y, t, cy);
					const m = mask[i];
					if (g.rand[i] > reveal * 1.35 - Math.abs((x + 0.5) / g.cols - 0.5)) {
						return null;
					}
					let intensity = f * (0.72 - 0.5 * gather) * (1 - 0.35 * resolveP);
					if (m > 0.05) {
						const ascii = m * gather * (1 - resolveP);
						intensity = Math.max(intensity, ascii);
					}
					const jitter = g.rand[i] > gather ? (Math.sin(i * 12.9898 + Math.floor(t / 90)) * 0.5) * 0.25 : 0;
					return quantize(Math.max(0, Math.min(1, intensity + jitter)), threshold);
				});
				gctx.clearRect(0, 0, glow.width, glow.height);
				gctx.drawImage(field, 0, 0, glow.width, glow.height);
				nameEl.style.opacity = String(resolveP * (1 - out));
				nameEl.style.filter = resolveP < 1 ? `blur(${(1 - resolveP) * 6}px)` : 'none';
				lineEls.forEach((el, k) => {
					decode(el, el.dataset.text, b + 250 + k * 380, 700, t);
					el.style.opacity = String(1 - out);
				});
				root.style.setProperty('--intro-glow', String((0.35 + 0.65 * reveal) * (1 - out)));
			};

			const onVisibility = () => {
				if (document.hidden) {
					cancelAnimationFrame(raf);
					last = null;
				} else if (!done) {
					raf = requestAnimationFrame(frame);
				}
			};

			document.addEventListener('visibilitychange', onVisibility);
			root.addEventListener('pointerdown', finish);
			window.addEventListener('keydown', finish, true);
			skip.addEventListener('click', finish);
			skip.focus({ preventScroll: true });
			if (!document.hidden) {
				raf = requestAnimationFrame(frame);
			}
		});
	}

	// One still, quiet frame of the field, brightest at the right edge, for the header band.
	function still(canvas, { dark = true } = {}) {
		const g = grid(canvas, 6, 10);
		const ctx = canvas.getContext('2d');
		ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
		const colors = palette(dark);
		const atlas = document.createElement('canvas');
		const cellW = 6;
		const cellH = 10;
		atlas.width = RAMP.length * cellW * g.dpr;
		atlas.height = LEVELS * cellH * g.dpr;
		const actx = atlas.getContext('2d');
		actx.scale(g.dpr, g.dpr);
		actx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
		actx.textAlign = 'center';
		actx.textBaseline = 'middle';
		for (let level = 0; level < LEVELS; level++) {
			const t = level / (LEVELS - 1);
			actx.fillStyle = `rgb(${mix(colors.lo[0], colors.hi[0], t)}, ${mix(colors.lo[1], colors.hi[1], t)}, ${mix(colors.lo[2], colors.hi[2], t)})`;
			for (let k = 1; k < RAMP.length; k++) {
				actx.fillText(RAMP[k], k * cellW + cellW / 2, level * cellH + cellH / 2 + 0.5);
			}
		}
		ctx.clearRect(0, 0, g.w, g.h);
		for (let y = 0; y < g.rows; y++) {
			for (let x = 0; x < g.cols; x++) {
				const nx = 1 - (x + 0.5) / g.cols;
				const ny = (y + 0.5) / g.rows - 0.55;
				const intensity = Math.exp(-((nx * nx) / 0.16 + (ny * ny) / 0.9)) * 0.85;
				const cell = quantize(intensity, BAYER[(y & 7) * 8 + (x & 7)]);
				if (cell) {
					ctx.drawImage(atlas, cell.glyph * cellW * g.dpr, cell.level * cellH * g.dpr, cellW * g.dpr, cellH * g.dpr, x * cellW, y * cellH, cellW, cellH);
				}
			}
		}
	}

	window.SetupIntro = { play, still, duration: END };
})();
