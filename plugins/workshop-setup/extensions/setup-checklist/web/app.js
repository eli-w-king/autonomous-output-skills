// Draws the checklist from /api/state and keeps it live over server-sent events. Text goes in with textContent only.
(function () {
	'use strict';

	const $ = (selector, root = document) => root.querySelector(selector);
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
	const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
	const svgNs = 'http://www.w3.org/2000/svg';
	let view = null;
	let introRunning = false;
	const seen = new Map();
	const signatures = new Map();

	// Status icons, drawn here so they need no font: a check, a ring, a spinner arc, a dot, a bar or a cross.
	function icon(status) {
		const svg = document.createElementNS(svgNs, 'svg');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('class', `icon icon-${status}`);
		const add = (tag, attrs) => {
			const el = document.createElementNS(svgNs, tag);
			for (const [key, value] of Object.entries(attrs)) {
				el.setAttribute(key, value);
			}
			svg.append(el);
		};
		const ring = { cx: '8', cy: '8', r: '6.5', fill: 'none', 'stroke-width': '1.2' };
		if (status === 'done') {
			add('circle', { cx: '8', cy: '8', r: '7', class: 'fill' });
			add('path', { d: 'M5 8.2l2 2 4-4.4', fill: 'none', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'mark' });
		} else if (status === 'installed') {
			add('circle', { ...ring, class: 'line' });
			add('path', { d: 'M5 8.2l2 2 4-4.4', fill: 'none', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'line' });
		} else if (status === 'checking' || status === 'working') {
			add('circle', { ...ring, class: 'track' });
			add('path', { d: 'M8 1.5a6.5 6.5 0 0 1 6.5 6.5', fill: 'none', 'stroke-width': '1.6', 'stroke-linecap': 'round', class: 'line spin' });
		} else if (status === 'needs-you') {
			add('circle', { ...ring, class: 'line' });
			add('circle', { cx: '8', cy: '8', r: '3', class: 'fill' });
		} else if (status === 'skipped') {
			add('circle', { ...ring, class: 'line' });
			add('path', { d: 'M5.2 8h5.6', 'stroke-width': '1.3', 'stroke-linecap': 'round', class: 'line' });
		} else if (status === 'failed') {
			add('circle', { cx: '8', cy: '8', r: '7', class: 'fill' });
			add('path', { d: 'M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8', 'stroke-width': '1.5', 'stroke-linecap': 'round', class: 'mark' });
		} else {
			add('circle', { ...ring, class: 'line' });
		}
		return svg;
	}

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		if (text !== undefined && text !== null) {
			node.textContent = text;
		}
		return node;
	}

	async function post(path, body) {
		const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
		if (!res.ok) {
			let message = 'That didn\'t work. Try again.';
			try {
				message = (await res.json()).error || message;
			} catch {
				// Keep the plain message.
			}
			throw new Error(message);
		}
		return res.json().catch(() => ({}));
	}

	function announce(text) {
		const live = $('#live');
		live.textContent = '';
		window.setTimeout(() => {
			live.textContent = text;
		}, 60);
	}

	async function copyText(text, button) {
		let ok = false;
		try {
			await navigator.clipboard.writeText(text);
			ok = true;
		} catch {
			const area = el('textarea');
			area.value = text;
			area.setAttribute('readonly', '');
			area.className = 'sr-only';
			document.body.append(area);
			area.select();
			try {
				ok = document.execCommand('copy');
			} catch {
				ok = false;
			}
			area.remove();
		}
		const label = button.textContent;
		button.textContent = ok ? 'Copied' : 'Select and copy';
		announce(ok ? 'Copied' : 'Copy didn\'t work. Select the text and copy it.');
		window.setTimeout(() => {
			button.textContent = label;
		}, 1600);
	}

	// A one-time sign-in code (GitHub's device code looks like 1A2B-3C4D) shows large, so it's easy to read and type.
	const SIGN_IN_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

	function copyRow(text, label) {
		const isCode = SIGN_IN_CODE.test(text);
		const row = el('div', isCode ? 'copy-row is-code' : 'copy-row');
		const code = el('code', 'copy-text', text);
		const button = el('button', 'copy', 'Copy');
		button.type = 'button';
		button.dataset.focus = `copy:${label}:${text.slice(0, 40)}`;
		button.setAttribute('aria-label', isCode ? `Copy the one-time code ${text.split('').join(' ')}` : `Copy ${label}`);
		button.addEventListener('click', () => copyText(text, button));
		row.append(code, button);
		return row;
	}

	function itemNode(item) {
		const li = el('li', `item status-${item.status}${item.current ? ' is-current' : ''}`);
		li.dataset.id = item.id;
		if (item.current) {
			li.setAttribute('aria-current', 'step');
		}
		li.append(icon(item.status));
		const body = el('div', 'item-body');
		const top = el('div', 'item-top');
		top.append(el('span', 'item-label', item.label), el('span', 'item-state', item.statusText));
		body.append(top);
		if (item.blurb && item.optional) {
			body.append(el('p', 'item-blurb', item.blurb));
		}
		// While the agent works on an item, its note says what's happening now.
		const detail = item.status === 'working' && item.note ? item.note : item.detail;
		const showDetail = detail && !['needs-you', 'failed', 'skipped'].includes(item.status);
		if (showDetail) {
			body.append(el('p', 'item-detail', detail));
		}
		if (item.status === 'needs-you' || item.status === 'failed') {
			const box = el('div', `callout callout-${item.status}`);
			const lines = (item.note || '').split('\n').filter(Boolean);
			if (item.status === 'failed') {
				box.append(el('p', 'callout-title', 'What went wrong'));
				box.append(el('pre', 'error-line', lines.join('\n') || item.detail || 'No error was given.'));
			} else if (lines.length > 1) {
				const list = el('ol', 'steps');
				lines.forEach((line) => list.append(el('li', null, line)));
				box.append(list);
			} else if (lines.length) {
				box.append(el('p', 'step', lines[0]));
			}
			(item.commands || []).forEach((command) => box.append(copyRow(command, `command for ${item.label}`)));
			body.append(box);
		}
		if (item.status === 'installed' && item.tryIt) {
			const box = el('div', 'callout callout-try');
			if (item.tryIt.kind === 'do') {
				box.append(el('p', 'callout-title', 'Try it'), el('p', 'step', item.tryIt.text));
			} else {
				box.append(el('p', 'callout-title', 'Try it: copy this into the chat and send it. Sending it is your okay.'));
				box.append(copyRow(item.tryIt.text, `Try it prompt for ${item.label}`));
			}
			body.append(box);
		}
		if (item.optional && !(item.status === 'done' || item.status === 'installed')) {
			const label = el('label', 'toggle');
			const input = el('input');
			input.type = 'checkbox';
			input.setAttribute('role', 'switch');
			input.checked = item.chosen;
			input.dataset.focus = `toggle:${item.id}`;
			const text = el('span', null, 'Set this up');
			input.addEventListener('change', async () => {
				input.disabled = true;
				try {
					await post('/api/choice', { id: item.id, on: input.checked });
					announce(input.checked ? `${item.label} turned on. Say "continue my setup" in the chat and the agent picks it up.` : `${item.label} turned off.`);
				} catch (error) {
					input.checked = !input.checked;
					announce(error.message);
				} finally {
					input.disabled = false;
				}
			});
			label.append(input, text);
			body.append(label);
			if (item.chosen && item.status === 'todo') {
				body.append(el('p', 'item-hint', 'Turned on. Say "continue my setup" in the chat and the agent picks it up.'));
			}
		}
		li.append(body);
		return li;
	}

	function renderGroups(groups) {
		const root = $('.groups');
		const active = document.activeElement?.dataset?.focus || null;
		const wanted = new Set(groups.map((group) => group.id));
		for (const section of [...root.children]) {
			if (!wanted.has(section.dataset.group)) {
				section.remove();
			}
		}
		let previous = null;
		for (const group of groups) {
			let section = root.querySelector(`section[data-group="${group.id}"]`);
			if (!section) {
				section = el('section', 'group');
				section.dataset.group = group.id;
				const head = el('div', 'group-head');
				const h2 = el('h2', null, group.label);
				h2.id = `group-${group.id}`;
				section.setAttribute('aria-labelledby', h2.id);
				head.append(h2, el('span', 'group-count'));
				section.append(head, el('p', 'group-blurb'), el('ul', 'items'));
			}
			section.classList.toggle('is-current', group.current);
			$('.group-count', section).textContent = group.total ? `${group.done} of ${group.total}` : '';
			$('.group-blurb', section).textContent = group.blurb || '';
			const list = $('.items', section);
			const ids = new Set(group.items.map((item) => item.id));
			for (const node of [...list.children]) {
				if (!ids.has(node.dataset.id)) {
					node.remove();
				}
			}
			let prevItem = null;
			for (const item of group.items) {
				const signature = JSON.stringify(item);
				let node = list.querySelector(`li[data-id="${CSS.escape(item.id)}"]`);
				if (!node || signatures.get(item.id) !== signature) {
					const fresh = itemNode(item);
					if (node) {
						node.replaceWith(fresh);
					}
					node = fresh;
					signatures.set(item.id, signature);
				}
				if (node.previousElementSibling !== prevItem || node.parentNode !== list) {
					if (prevItem) {
						prevItem.after(node);
					} else {
						list.prepend(node);
					}
				}
				prevItem = node;
			}
			if (section.previousElementSibling !== previous || section.parentNode !== root) {
				if (previous) {
					previous.after(section);
				} else {
					root.prepend(section);
				}
			}
			previous = section;
		}
		if (active) {
			const again = [...document.querySelectorAll('[data-focus]')].find((node) => node.dataset.focus === active);
			if (again && document.activeElement !== again) {
				again.focus({ preventScroll: true });
			}
		}
	}

	function formatTime(value) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	}

	function renderHeader(next) {
		const { progress, check, step, allDone } = next;
		const fraction = progress.total ? progress.done / progress.total : 0;
		const bar = $('.progress');
		bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100) / 100));
		bar.setAttribute('aria-valuetext', `${progress.done} of ${progress.total} done`);
		$('.progress-fill').style.transform = `scaleX(${fraction})`;
		let text = check.checking && !check.at ? 'Checking your setup' : `${progress.done} of ${progress.total} done`;
		if (allDone) {
			text = `All ${progress.total} done. You're all set.`;
		}
		$('#progress-text').textContent = text;
		$('.now').textContent = step ? `Now: ${step.label}` : '';
		$('.checked').textContent = check.checking ? 'Checking' : check.at ? `Checked ${formatTime(check.at)}` : '';
		// aria-disabled rather than disabled, so keyboard focus stays on the button while the check runs.
		const button = $('.refresh');
		button.setAttribute('aria-disabled', String(!!check.checking));
		button.classList.toggle('is-busy', !!check.checking);
		const error = $('.check-error');
		error.hidden = !check.error;
		error.textContent = check.error || '';
	}

	function renderSim(sim) {
		const bar = $('.sim');
		bar.hidden = !sim;
		if (!sim) {
			return;
		}
		$('.sim-desc').textContent = sim.state === 'failed'
			? `It stopped: ${sim.error || 'something went wrong'}. Replay to start over.`
			: `${sim.label}, set up from scratch. Nothing on this computer is checked or changed.`;
		const play = $('.sim-play');
		play.hidden = !['playing', 'paused'].includes(sim.state);
		play.textContent = sim.state === 'paused' ? 'Play' : 'Pause';
	}

	function renderBand(meta) {
		const band = $('.band');
		const has = !!(meta.title || meta.subtitle || meta.presenter);
		band.hidden = !has;
		if (!has) {
			return;
		}
		$('.band-subtitle').textContent = meta.subtitle || '';
		$('.band-title').textContent = meta.title || '';
		$('.band-presenter').textContent = meta.presenter || '';
		if (window.SetupIntro) {
			window.SetupIntro.still($('.band-field'), { dark: darkQuery.matches });
		}
	}

	function announceChanges(next) {
		const messages = [];
		for (const group of next.groups) {
			for (const item of group.items) {
				const before = seen.get(item.id);
				if (before && before !== item.status && ['done', 'installed', 'needs-you', 'failed'].includes(item.status)) {
					messages.push(`${item.label}: ${item.statusText}`);
				}
				seen.set(item.id, item.status);
			}
		}
		if (messages.length) {
			announce(messages.slice(0, 3).join('. '));
		}
	}

	function render(next) {
		const stepChanged = next.step?.id !== view?.step?.id;
		const metaChanged = JSON.stringify(next.meta) !== JSON.stringify(view?.meta);
		const first = !view;
		renderHeader(next);
		renderSim(next.simulation);
		if (first || metaChanged) {
			renderBand(next.meta);
		}
		renderGroups(next.groups);
		const later = $('.later');
		later.hidden = !next.later;
		$('.later-text').textContent = next.later ? next.later.note : '';
		if (!first) {
			announceChanges(next);
		} else {
			next.groups.forEach((group) => group.items.forEach((item) => seen.set(item.id, item.status)));
		}
		view = next;
		if (stepChanged && next.step && !introRunning) {
			revealStep(next.step);
		}
	}

	function revealStep(step) {
		if (!step) {
			return;
		}
		const target = step.kind === 'item' ? document.querySelector(`li[data-id="${CSS.escape(step.id)}"]`) : document.querySelector(`section[data-group="${CSS.escape(step.id)}"]`);
		target?.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
	}

	// The opening (once per open, when motion is on) and the welcome (until the person closes it once). With reduced
	// motion the welcome is a still page.
	async function runIntro(next) {
		const welcome = !!next.welcome?.show;
		const cinematic = !!next.intro?.play && !reduced.matches;
		if (!window.SetupIntro || (!welcome && !cinematic)) {
			return;
		}
		introRunning = true;
		const meta = next.meta;
		const name = meta.presenter || meta.title || 'Setup';
		const lines = [meta.subtitle, meta.presenter ? meta.title : null].filter(Boolean);
		const main = $('#main');
		main.inert = true;
		if (next.intro?.play) {
			post('/api/intro').catch(() => {});
		}
		try {
			await window.SetupIntro.play($('#intro'), { name, lines, dark: darkQuery.matches, cinematic, welcome, motion: !reduced.matches, os: next.os });
			if (welcome) {
				await post('/api/welcome').catch(() => {});
			}
		} finally {
			main.inert = false;
			introRunning = false;
			$('#page-title').focus({ preventScroll: true });
			revealStep(view?.step);
		}
	}

	// A simulation starts once its intro is over, so the run plays from the first check.
	async function startSim(state) {
		await runIntro(state);
		if (state.simulation) {
			await post('/api/sim', { action: 'start' });
		}
	}

	async function start() {
		$('.refresh').addEventListener('click', async (event) => {
			if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
				return;
			}
			try {
				await post('/api/check');
				announce('Checking your setup');
			} catch (error) {
				announce(error.message);
			}
		});
		$('.sim-play').addEventListener('click', async () => {
			const action = view?.simulation?.state === 'paused' ? 'play' : 'pause';
			try {
				await post('/api/sim', { action });
				announce(action === 'pause' ? 'Paused' : 'Playing');
			} catch (error) {
				announce(error.message);
			}
		});
		$('.sim-replay').addEventListener('click', async () => {
			try {
				await post('/api/sim', { action: 'replay' });
				const fresh = await (await fetch('/api/state')).json();
				seen.clear();
				render(fresh);
				await startSim(fresh);
			} catch (error) {
				announce(error.message);
			}
		});
		let first = null;
		try {
			const res = await fetch('/api/state');
			first = await res.json();
			render(first);
		} catch {
			$('#progress-text').textContent = 'The checklist can\'t reach its server. Ask the agent to open it again.';
		}
		if (first) {
			startSim(first).catch(() => {});
		}
		const events = new EventSource('/api/events');
		events.addEventListener('state', (event) => {
			try {
				render(JSON.parse(event.data));
			} catch {
				// Ignore a malformed update; the next one replaces it.
			}
		});
		darkQuery.addEventListener('change', () => view && renderBand(view.meta));
	}

	start();
})();
