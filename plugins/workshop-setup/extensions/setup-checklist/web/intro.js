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

	// The poster's ordered dither: black through ocean blue (#1e87a8) to teal (#75e2e1); deep teal ink in light mode.
	function palette(dark) {
		return dark
			? { stops: [[10, 38, 50], [30, 135, 168], [117, 226, 225]] }
			: { stops: [[184, 224, 226], [64, 158, 172], [8, 104, 116]] };
	}

	function shade(colors, t) {
		const [a, b, c] = colors.stops;
		const [from, to, k] = t < 0.5 ? [a, b, t * 2] : [b, c, (t - 0.5) * 2];
		return `rgb(${mix(from[0], to[0], k)}, ${mix(from[1], to[1], k)}, ${mix(from[2], to[2], k)})`;
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
			ctx.fillStyle = shade(colors, t);
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
	// The size goes in --name-size, which the welcome layout scales down.
	function fitName(el, maxWidth) {
		el.style.removeProperty('--name-size');
		const size = parseFloat(getComputedStyle(el).fontSize);
		const width = el.scrollWidth;
		const fitted = maxWidth > 0 && width > maxWidth ? Math.max(14, Math.floor((size * maxWidth) / width)) : size;
		el.style.setProperty('--name-size', `${fitted}px`);
	}

	const LIFT_MS = 700;
	const WELCOME_AFTER_MS = 400;
	const IDLE_FRAME_MS = 1000 / 20;
	const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

	// The opening. With cinematic, the field dithers in and gathers into the host's name. With welcome, the name then
	// lifts and the two welcome steps take its place over the living field until the person continues; without it,
	// the field dissolves into the checklist. With motion off, the welcome is one still, readable frame.
	function play(root, { name, lines = [], dark = true, cinematic = true, welcome = false, motion = true, os = 'other' } = {}) {
		return new Promise((resolve) => {
			const animate = motion && cinematic;
			if (!animate && !welcome) {
				resolve();
				return;
			}
			const field = root.querySelector('.intro-field');
			const glow = root.querySelector('.intro-glow');
			const box = root.querySelector('.intro-lines');
			const skip = root.querySelector('.intro-skip');
			const card = root.querySelector('.welcome');
			const steps = [...card.querySelectorAll('.welcome-step')];
			const next = card.querySelector('.welcome-next');
			const back = card.querySelector('.welcome-back');
			const go = card.querySelector('.welcome-go');
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
			for (const list of card.querySelectorAll('[data-os]')) {
				list.hidden = list.dataset.os !== (['mac', 'win'].includes(os) ? os : 'other');
			}
			card.hidden = true;
			card.style.opacity = '';
			steps.forEach((step, k) => {
				step.hidden = k !== 0;
				step.classList.remove('is-entering');
			});
			root.classList.remove('is-welcome', 'is-welcome-in');
			root.classList.toggle('is-light', !dark);
			root.classList.toggle('is-quick', motion && !cinematic);
			skip.hidden = !animate;
			root.hidden = false;
			root.scrollTop = 0;
			fitName(nameEl, root.clientWidth - 64);
			const colors = palette(dark);
			const g = grid(field, CELL_W, CELL_H);
			const ctx = field.getContext('2d');
			ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
			const atlas = makeAtlas(colors, g.dpr, CELL_W, CELL_H);
			const rootRect = root.getBoundingClientRect();
			const mask = animate ? nameMask(g, nameEl, rootRect.top, rootRect.left) : new Float32Array(g.cols * g.rows);
			const centerOf = (el, low) => {
				const rect = el.getBoundingClientRect();
				return Math.min(0.62, Math.max(low, (rect.top + rect.height / 2 - root.getBoundingClientRect().top) / Math.max(1, g.h)));
			};
			let cy0 = centerOf(nameEl, 0.3);
			let cy1 = cy0;
			// The glow is the field's light, one pixel per cell, which CSS blurs. (A scaled copy of the glyphs aliases
			// on their grid and puts a false patch of light where the dots happen to line up.)
			glow.width = g.cols;
			glow.height = g.rows;
			const gctx = glow.getContext('2d');
			const glowImage = gctx.createImageData(g.cols, g.rows);
			const glowPx = glowImage.data;
			const [glowR, glowG, glowB] = colors.stops[1];

			const RESOLVED = T.boot + T.gather + T.resolve;
			let elapsed = animate ? 0 : RESOLVED;
			let stage = animate ? 'cinema' : 'welcome';
			let liftAt = null;
			let outAt = null;
			let last = null;
			let raf = 0;
			let done = false;

			const render = (t) => {
				const reveal = smooth(t / T.boot);
				const gather = smooth((t - T.boot) / T.gather);
				const resolveP = smooth((t - T.boot - T.gather) / T.resolve);
				const lift = liftAt === null ? 0 : motion ? smooth((t - liftAt) / LIFT_MS) : 1;
				const out = outAt === null ? 0 : smooth((t - outAt) / T.out);
				// Behind the welcome the field comes back up a little, so the background stays alive while they read.
				const ambient = 1 + 0.8 * lift;
				const cy = cy0 + (cy1 - cy0) * lift;
				drawCells(ctx, g, atlas, (x, y, i) => {
					glowPx[i * 4 + 3] = 0;
					const threshold = BAYER[(y & 7) * 8 + (x & 7)];
					if (out > 0 && threshold < out) {
						return null;
					}
					if (g.rand[i] > reveal * 1.35 - Math.abs((x + 0.5) / g.cols - 0.5)) {
						return null;
					}
					const f = fieldAt(g, x, y, t, cy);
					const m = mask[i];
					let intensity = f * (0.72 - 0.5 * gather) * (1 - 0.35 * resolveP) * ambient;
					if (m > 0.05) {
						intensity = Math.max(intensity, m * gather * (1 - resolveP));
					}
					const jitter = g.rand[i] > gather ? (Math.sin(i * 12.9898 + Math.floor(t / 90)) * 0.5) * 0.25 : 0;
					const value = Math.max(0, Math.min(1, intensity + jitter));
					glowPx[i * 4] = glowR;
					glowPx[i * 4 + 1] = glowG;
					glowPx[i * 4 + 2] = glowB;
					glowPx[i * 4 + 3] = Math.round(value * 255);
					return quantize(value, threshold);
				});
				gctx.putImageData(glowImage, 0, 0);
				nameEl.style.opacity = String(resolveP * (1 - out));
				nameEl.style.filter = resolveP < 1 ? `blur(${(1 - resolveP) * 6}px)` : 'none';
				lineEls.forEach((el, k) => {
					if (animate && liftAt === null) {
						decode(el, el.dataset.text, T.boot + T.gather + 250 + k * 380, 700, t);
					} else if (el.textContent !== el.dataset.text) {
						el.textContent = el.dataset.text;
					}
					el.style.opacity = String(1 - out);
				});
				if (out > 0) {
					card.style.opacity = String(1 - out);
				}
				root.style.setProperty('--intro-glow', String((0.35 + 0.65 * reveal) * (1 - out)));
				root.style.setProperty('--glow-y', `${Math.round(cy * 100)}%`);
			};

			const showStep = (index, { enter = true } = {}) => {
				steps.forEach((step, k) => {
					step.hidden = k !== index;
					step.classList.toggle('is-entering', k === index && enter && motion);
				});
				const heading = steps[index].querySelector('.welcome-title');
				root.setAttribute('aria-labelledby', heading.id);
				heading.focus({ preventScroll: true });
				if (steps[index].getBoundingClientRect().top < 0 || card.getBoundingClientRect().bottom > root.clientHeight) {
					card.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' });
				}
			};

			// The name and its lines glide from the middle to the top as the welcome comes in (measure, move, play back).
			const openWelcome = (withLift) => {
				stage = 'welcome';
				liftAt = elapsed;
				skip.hidden = true;
				const items = [nameEl, ...lineEls];
				items.forEach((el) => {
					el.textContent = el === nameEl ? name : el.dataset.text;
				});
				const before = withLift ? items.map((el) => el.getBoundingClientRect()) : null;
				card.hidden = false;
				root.classList.add('is-welcome');
				root.setAttribute('role', 'dialog');
				root.setAttribute('aria-modal', 'true');
				// Measure the final layout (and where the field's light goes) before any transform plays.
				const after = items.map((el) => el.getBoundingClientRect());
				cy1 = centerOf(nameEl, 0.08);
				if (withLift) {
					items.forEach((el, k) => {
						const b = before[k];
						const a = after[k];
						if (!a.width || !a.height || !b.width) {
							return;
						}
						const dx = b.left + b.width / 2 - (a.left + a.width / 2);
						const dy = b.top + b.height / 2 - (a.top + a.height / 2);
						el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${b.width / a.width})` }, { transform: 'none' }],
							{ duration: LIFT_MS, easing: 'cubic-bezier(.2, .7, .2, 1)' });
					});
				}
				if (!withLift) {
					cy0 = cy1;
				}
				void card.offsetWidth;
				root.classList.add('is-welcome-in');
				showStep(0, { enter: false });
			};

			const finish = () => {
				if (done) {
					return;
				}
				done = true;
				cancelAnimationFrame(raf);
				document.removeEventListener('visibilitychange', onVisibility);
				root.removeEventListener('pointerdown', onPointer);
				window.removeEventListener('keydown', onKey, true);
				skip.removeEventListener('click', skipAhead);
				next.removeEventListener('click', onNext);
				back.removeEventListener('click', onBack);
				go.removeEventListener('click', leave);
				root.hidden = true;
				card.hidden = true;
				root.classList.remove('is-welcome', 'is-welcome-in', 'is-quick');
				['role', 'aria-modal', 'aria-labelledby'].forEach((attr) => root.removeAttribute(attr));
				resolve();
			};

			// Show my checklist: the field and the welcome dissolve together, or close at once without motion.
			function leave() {
				if (done || stage === 'out') {
					return;
				}
				if (!motion) {
					finish();
					return;
				}
				stage = 'out';
				outAt = elapsed;
			}

			// A click or a key during the opening skips to the welcome (or to the checklist when there's no welcome).
			function skipAhead() {
				if (stage !== 'cinema') {
					return;
				}
				if (welcome) {
					elapsed = Math.max(elapsed, RESOLVED);
					openWelcome(true);
				} else {
					finish();
				}
			}

			const onPointer = () => skipAhead();
			const onNext = () => showStep(1);
			const onBack = () => showStep(0);
			const onKey = (event) => {
				if (stage === 'cinema' && !MODIFIERS.has(event.key)) {
					if (event.key === ' ' || event.key === 'Enter') {
						event.preventDefault();
					}
					skipAhead();
				} else if (stage === 'welcome' && event.key === 'Escape') {
					event.preventDefault();
					leave();
				}
			};

			const frame = (now) => {
				if (done) {
					return;
				}
				if (last !== null) {
					const step = now - last;
					const idle = stage === 'welcome' && elapsed - liftAt > LIFT_MS;
					if (step < (idle ? IDLE_FRAME_MS : FRAME_MS) - 2) {
						raf = requestAnimationFrame(frame);
						return;
					}
					elapsed += Math.min(step, 100);
				}
				last = now;
				if (stage === 'cinema' && elapsed >= RESOLVED) {
					if (welcome) {
						if (elapsed >= RESOLVED + WELCOME_AFTER_MS) {
							openWelcome(true);
						}
					} else if (elapsed >= RESOLVED + T.hold) {
						stage = 'out';
						outAt = RESOLVED + T.hold;
					}
				}
				render(elapsed);
				if (stage === 'out' && elapsed >= outAt + T.out) {
					finish();
					return;
				}
				raf = requestAnimationFrame(frame);
			};

			const onVisibility = () => {
				if (document.hidden) {
					cancelAnimationFrame(raf);
					last = null;
				} else if (!done && motion) {
					raf = requestAnimationFrame(frame);
				}
			};

			document.addEventListener('visibilitychange', onVisibility);
			root.addEventListener('pointerdown', onPointer);
			window.addEventListener('keydown', onKey, true);
			skip.addEventListener('click', skipAhead);
			next.addEventListener('click', onNext);
			back.addEventListener('click', onBack);
			go.addEventListener('click', leave);
			if (animate) {
				skip.focus({ preventScroll: true });
			} else {
				openWelcome(false);
				render(elapsed);
			}
			if (motion && !document.hidden) {
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
			actx.fillStyle = shade(colors, t);
			for (let k = 1; k < RAMP.length; k++) {
				actx.fillText(RAMP[k], k * cellW + cellW / 2, level * cellH + cellH / 2 + 0.5);
			}
		}
		ctx.clearRect(0, 0, g.w, g.h);
		for (let y = 0; y < g.rows; y++) {
			for (let x = 0; x < g.cols; x++) {
				const nx = 1 - (x + 0.5) / g.cols;
				const ny = (y + 0.5) / g.rows;
				const intensity = Math.exp(-((nx * nx) / 0.22 + (ny * ny) / 1.1 + (nx * ny) / 0.5)) * 0.9;
				const cell = quantize(intensity, BAYER[(y & 7) * 8 + (x & 7)]);
				if (cell) {
					ctx.drawImage(atlas, cell.glyph * cellW * g.dpr, cell.level * cellH * g.dpr, cellW * g.dpr, cellH * g.dpr, x * cellW, y * cellH, cellW, cellH);
				}
			}
		}
	}

	window.SetupIntro = { play, still, duration: END };
})();
