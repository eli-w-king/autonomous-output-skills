// The AI-First welcome's motion: the horizon band. An ordered (Bayer 8x8) dither rises from the bottom of the panel and
// climbs toward the right, dissolving upward into the white ground through visible square cells, with a glow from
// the bottom right corner and continuous light at its core. It develops once (the cells resolve from coarse to fine
// as the glow rises), then holds still. Shape, colors and timing come from welcome.css. When the Horizon kit is
// loaded (window.Horizon.mount), it draws the band instead.
//   SetupWelcome.play(host, { motion, ambient })  develops the band once (with the kit, ambient keeps it moving
//                                                 calmly); resolves when it settles
//   SetupWelcome.still(host)             draws the settled band (and keeps it sharp on resize)
(function () {
	'use strict';

	const BAYER = (() => {
		let m = [[0]];
		for (let n = 1; n < 8; n *= 2) {
			const next = [];
			for (let y = 0; y < n * 2; y++) {
				next.push([]);
				for (let x = 0; x < n * 2; x++) {
					next[y].push(m[y % n][x % n] * 4 + [0, 2, 3, 1][(y < n ? 0 : 2) + (x < n ? 0 : 1)]);
				}
			}
			m = next;
		}
		const flat = new Float32Array(64);
		for (let i = 0; i < 64; i++) {
			flat[i] = (m[i >> 3][i & 7] + 0.5) / 64;
		}
		return flat;
	})();

	const clamp = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
	const smooth = (t) => {
		const x = clamp(t);
		return x * x * (3 - 2 * x);
	};
	const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
	const BUCKETS = 40;
	const PEAK = 1.6;

	function parseStops(text) {
		const stops = String(text || '').split(',').map((part) => part.trim().split(/\s+/)).map(([color, at]) => {
			const m = /^#([0-9a-f]{6})$/i.exec(color || '');
			return m ? [Number(at) || 0, parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
		}).filter(Boolean);
		return stops.length >= 2 ? stops : [[0, 18, 72, 116], [0.5, 35, 144, 185], [1.4, 122, 225, 227], [2.3, 196, 245, 243]];
	}

	function ramp(stops, value) {
		if (value <= stops[0][0]) {
			return stops[0].slice(1);
		}
		for (let i = 1; i < stops.length; i++) {
			if (value <= stops[i][0]) {
				const a = stops[i - 1];
				const b = stops[i];
				const f = (value - a[0]) / (b[0] - a[0]);
				return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
			}
		}
		return stops[stops.length - 1].slice(1);
	}

	class Band {
		constructor(host) {
			this.host = host;
			this.canvas = host.querySelector('.hero-field');
			this.low = document.createElement('canvas');
		}

		measure() {
			const css = getComputedStyle(this.host);
			const num = (name, fallback) => {
				const value = parseFloat(css.getPropertyValue(name));
				return Number.isNaN(value) ? fallback : value;
			};
			this.W = this.host.offsetWidth;
			this.H = this.host.offsetHeight;
			this.px = Math.min(window.devicePixelRatio || 1, 2);
			this.cell = num('--cell', 5);
			const left = num('--band-left', 0.36);
			const right = num('--band-right', 0.7);
			this.left = left <= 1.5 ? left * this.H : left;
			this.right = right <= 1.5 ? right * this.H : right;
			this.curve = num('--curve', 1.6);
			this.glow = num('--glow', 0.6);
			this.developMs = num('--welcome-develop-ms', 1800);
			this.stops = parseStops(css.getPropertyValue('--welcome-stops'));
			this.colors = [];
			for (let i = 0; i < BUCKETS; i++) {
				const c = ramp(this.stops, ((i + 0.5) / BUCKETS) * PEAK);
				this.colors.push(`rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`);
			}
			const canvas = this.canvas;
			canvas.style.width = `${this.W}px`;
			canvas.style.height = `${this.H}px`;
			const bw = Math.max(1, Math.round(this.W * this.px));
			const bh = Math.max(1, Math.round(this.H * this.px));
			if (canvas.width !== bw || canvas.height !== bh) {
				canvas.width = bw;
				canvas.height = bh;
			}
			this.lw = Math.max(2, Math.ceil(this.W / 6));
			this.lh = Math.max(2, Math.ceil(this.H / 6));
			this.low.width = this.lw;
			this.low.height = this.lh;
		}

		// 0 at the band's dissolving edge, above 1 in its smooth core.
		field(x, y, rise) {
			const u = x / this.W;
			const reveal = smooth((u - (1 - 1.8 * rise)) / 0.8);
			let th = (this.left + (this.right - this.left) * Math.pow(u, this.curve)) * (1 + 0.05 * Math.sin(u * 7.3 + 1.1) + 0.03 * Math.sin(u * 17.9 + 0.3));
			th *= reveal * (0.35 + 0.65 * rise);
			const depth = th > 1 ? (y - (this.H - th)) / th : -1;
			const cx = 1 - u;
			const cy = (this.H - y) / Math.max(this.right, 1);
			const glow = this.glow * Math.exp(-(cx * cx * 5 + cy * cy * 2.2)) * rise;
			const value = depth * 1.75 + glow;
			return value > 0 ? value : 0;
		}

		draw(rise, level, smoothAmount) {
			const ctx = this.canvas.getContext('2d');
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			if (rise <= 0) {
				return;
			}
			const size = this.cell * level * this.px;
			const cols = Math.ceil(this.canvas.width / size);
			const rows = Math.ceil(this.canvas.height / size);
			const tallest = Math.max(this.left, this.right) * 1.25 + this.right * 0.6;
			const first = Math.max(0, Math.floor(((this.H - tallest) * this.px) / size));
			const paths = new Array(BUCKETS);
			for (let r = first; r < rows; r++) {
				const y0 = Math.round(r * size);
				const y1 = Math.round((r + 1) * size);
				const yc = ((r + 0.5) * size) / this.px;
				for (let c = 0; c < cols; c++) {
					const value = this.field(((c + 0.5) * size) / this.px, yc, rise);
					if (value <= 0 || (value < 1 && value < BAYER[((r & 7) << 3) + (c & 7)])) {
						continue;
					}
					const bucket = Math.min(BUCKETS - 1, Math.floor((value / PEAK) * BUCKETS));
					const x0 = Math.round(c * size);
					(paths[bucket] || (paths[bucket] = new Path2D())).rect(x0, y0, Math.round((c + 1) * size) - x0, y1 - y0);
				}
			}
			for (let k = 0; k < BUCKETS; k++) {
				if (paths[k]) {
					ctx.fillStyle = this.colors[k];
					ctx.fill(paths[k]);
				}
			}
			if (smoothAmount > 0) {
				const lctx = this.low.getContext('2d');
				const image = lctx.createImageData(this.lw, this.lh);
				const data = image.data;
				const sx = this.W / this.lw;
				const sy = this.H / this.lh;
				for (let j = 0; j < this.lh; j++) {
					for (let i = 0; i < this.lw; i++) {
						const value = this.field((i + 0.5) * sx, (j + 0.5) * sy, rise);
						const alpha = smooth((value - 0.92) / 0.5) * smoothAmount;
						const o = (j * this.lw + i) * 4;
						if (alpha <= 0) {
							data[o + 3] = 0;
							continue;
						}
						const c = ramp(this.stops, value);
						data[o] = c[0];
						data[o + 1] = c[1];
						data[o + 2] = c[2];
						data[o + 3] = alpha * 255;
					}
				}
				lctx.putImageData(image, 0, 0);
				ctx.imageSmoothingEnabled = true;
				ctx.imageSmoothingQuality = 'high';
				ctx.drawImage(this.low, 0, 0, this.canvas.width, this.canvas.height);
			}
		}
	}

	const bands = new WeakMap();

	function bandFor(host) {
		let band = bands.get(host);
		if (!band) {
			band = new Band(host);
			bands.set(host, band);
			if (typeof ResizeObserver === 'function') {
				let frame = 0;
				new ResizeObserver(() => {
					if (host.classList.contains('is-playing')) {
						return;
					}
					cancelAnimationFrame(frame);
					frame = requestAnimationFrame(() => {
						band.measure();
						band.draw(1, 1, 1);
					});
				}).observe(host);
			}
		}
		return band;
	}

	// The Horizon kit (web/horizon, loaded in the page's head) draws the band when it's there, and this file only mounts
	// it with the welcome's settings from welcome.css.
	function kit() {
		return window.Horizon && typeof window.Horizon.mount === 'function' ? window.Horizon : null;
	}

	function kitOptions(host, motion, ambient, onIntroEnd) {
		const css = getComputedStyle(host);
		const num = (name, fallback) => {
			const value = parseFloat(css.getPropertyValue(name));
			return Number.isNaN(value) ? fallback : value;
		};
		// The kit's setup canvas settings (its demo/canvas.js): the rise once per open, then a calm arrival loop with no
		// bigger moments.
		return {
			intro: motion ? 'rise' : 'none',
			ambient,
			interactive: ambient,
			level: num('--welcome-level', 0.5),
			tilt: num('--welcome-tilt', 0.34),
			cell: num('--cell', 5),
			speed: num('--welcome-speed', 0.6),
			intensity: num('--welcome-intensity', 0.7),
			swell: num('--welcome-swell', 0.6),
			moments: 0,
			onIntroEnd,
		};
	}

	function mountKit(host, motion, ambient = motion) {
		return new Promise((resolve) => {
			host.classList.add('uses-kit');
			if (host.horizon) {
				// After Confirm the band settles into a still strip, so the checklist never reads over motion.
				const settings = kitOptions(host, false, false, null);
				host.horizon.set?.({ interactive: false, cell: settings.cell });
				host.horizon.setMotion?.(0, { duration: 1600 });
				host.horizon.setLevel?.(settings.level, { duration: 900 });
				host.horizon.setTilt?.(settings.tilt, { duration: 900 });
				host.horizon.refresh?.();
				resolve();
				return;
			}
			let settled = false;
			const finish = () => {
				if (!settled) {
					settled = true;
					resolve();
				}
			};
			host.horizon = kit().mount(host, kitOptions(host, motion, ambient, finish));
			const ms = parseFloat(getComputedStyle(host).getPropertyValue('--welcome-develop-ms')) || 2600;
			// The kit calls onIntroEnd when the rise ends; this covers no motion at all.
			setTimeout(finish, motion ? ms + 600 : 0);
		});
	}

	function still(host) {
		if (kit()) {
			mountKit(host, false);
			return;
		}
		const band = bandFor(host);
		band.measure();
		band.draw(1, 1, 1);
	}

	async function play(host, { motion = true, ambient = motion } = {}) {
		if (kit()) {
			if (motion) {
				host.classList.add('is-playing');
			}
			await mountKit(host, motion, ambient);
			host.classList.remove('is-playing');
			return;
		}
		if (!motion) {
			still(host);
			return;
		}
		host.classList.add('is-playing');
		const band = bandFor(host);
		band.measure();
		await new Promise((resolve) => {
			const total = band.developMs / 1000;
			let elapsed = -0.1;
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
				band.measure();
				band.draw(1, 1, 1);
				// The names and card finish their own entrance a moment later.
				setTimeout(() => {
					host.classList.remove('is-playing');
					resolve();
				}, 900);
			};
			const frame = (now) => {
				if (last === null) {
					last = now;
				}
				elapsed += Math.min(64, now - last) / 1000;
				last = now;
				const t = elapsed * (1.85 / total);
				if (t >= 0) {
					const level = t < 0.45 ? 8 : t < 0.8 ? 4 : t < 1.12 ? 2 : 1;
					band.draw(easeOut(t / 1.7), level, smooth((t - 0.95) / 0.8));
				}
				if (t < 1.85) {
					raf = requestAnimationFrame(frame);
				} else {
					finish();
				}
			};
			const onVisibility = () => {
				if (document.hidden) {
					finish();
				}
			};
			document.addEventListener('visibilitychange', onVisibility);
			raf = requestAnimationFrame(frame);
		});
	}

	window.SetupWelcome = { play, still };
})();
