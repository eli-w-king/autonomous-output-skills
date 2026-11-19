// The AI-First path's steps: the workshop picker, the Microsoft sign-in note, "Let's get your computer ready", what
// we'll install (locks, switches, sizes and the total), how to undo it, what happens after Confirm, and Confirm. Then
// the hero becomes a band above the live checklist (app.js draws that). Text goes in with textContent only.
(function () {
	'use strict';

	const svgNs = 'http://www.w3.org/2000/svg';
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
	let lastSignature = null;
	let lastStep = null;
	let pickChoice = null;
	let played = false;

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

	// Small icons drawn from shapes: a lock, a filled check and an info mark.
	function glyph(name, className) {
		const svg = document.createElementNS(svgNs, 'svg');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		if (className) {
			svg.setAttribute('class', className);
		}
		const add = (tag, attrs) => {
			const node = document.createElementNS(svgNs, tag);
			for (const [key, value] of Object.entries(attrs)) {
				node.setAttribute(key, value);
			}
			svg.append(node);
		};
		if (name === 'lock') {
			add('rect', { x: '3.5', y: '7', width: '9', height: '7', rx: '1.5' });
			add('path', { d: 'M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' });
		} else if (name === 'check') {
			add('circle', { cx: '8', cy: '8', r: '7' });
			add('path', { d: 'M5 8.2l2 2 4-4.4', fill: 'none', stroke: '#ffffff', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
		} else {
			add('circle', { cx: '8', cy: '8', r: '6.6', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3' });
			add('circle', { cx: '8', cy: '5', r: '1' });
			add('rect', { x: '7.3', y: '7', width: '1.4', height: '4.6', rx: '.7' });
		}
		return svg;
	}

	function spinner() {
		const svg = document.createElementNS(svgNs, 'svg');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('aria-hidden', 'true');
		const track = document.createElementNS(svgNs, 'circle');
		track.setAttribute('cx', '8');
		track.setAttribute('cy', '8');
		track.setAttribute('r', '6.5');
		track.setAttribute('fill', 'none');
		track.setAttribute('stroke', 'currentColor');
		track.setAttribute('stroke-opacity', '.25');
		track.setAttribute('stroke-width', '1.4');
		const arc = document.createElementNS(svgNs, 'path');
		arc.setAttribute('d', 'M8 1.5a6.5 6.5 0 0 1 6.5 6.5');
		arc.setAttribute('fill', 'none');
		arc.setAttribute('stroke', 'currentColor');
		arc.setAttribute('stroke-width', '1.6');
		arc.setAttribute('stroke-linecap', 'round');
		arc.setAttribute('class', 'spin');
		svg.append(track, arc);
		return svg;
	}

	function button(text, { primary = false, back = false, disabled = false } = {}) {
		const node = el('button', [primary ? 'primary' : '', back ? 'flow-back' : ''].filter(Boolean).join(' '), text);
		node.type = 'button';
		if (disabled) {
			node.setAttribute('aria-disabled', 'true');
		}
		return node;
	}

	function guarded(node, fn) {
		node.addEventListener('click', async () => {
			if (node.getAttribute('aria-disabled') === 'true') {
				return;
			}
			node.setAttribute('aria-busy', 'true');
			try {
				await fn();
			} finally {
				node.removeAttribute('aria-busy');
			}
		});
		return node;
	}

	function head(card, { count, title, lede }) {
		if (count) {
			card.append(el('p', 'flow-count', count));
		}
		const h = el('h2', 'flow-title', title);
		h.id = 'flow-title';
		h.tabIndex = -1;
		card.append(h);
		if (lede) {
			card.append(el('p', 'flow-lede', lede));
		}
	}

	const countText = (flow, step) => `Step ${flow.steps.indexOf(step) + 1} of ${flow.steps.length}`;

	function renderPick(card, view, api) {
		const flow = view.flow;
		head(card, { count: countText(flow, 'pick'), title: 'Which workshop are you setting up for?', lede: 'Pick yours. Nothing is installed until you confirm, a few steps from now.' });
		const set = el('fieldset', 'pick-options');
		set.append(el('legend', null, 'Workshop'));
		pickChoice = pickChoice || flow.pick || null;
		const next = button('Continue', { primary: true, disabled: !pickChoice });
		for (const workshop of flow.workshops) {
			const label = el('label', 'pick-option');
			const input = el('input');
			input.type = 'radio';
			input.name = 'workshop';
			input.value = workshop.id;
			input.checked = pickChoice === workshop.id;
			input.dataset.focus = `pick:${workshop.id}`;
			input.addEventListener('change', () => {
				pickChoice = workshop.id;
				next.removeAttribute('aria-disabled');
			});
			const text = el('span');
			const name = el('span', 'pick-name', workshop.label);
			name.append(el('span', 'pick-tag', workshop.tag));
			text.append(name, el('span', 'pick-blurb', workshop.blurb));
			label.append(input, text);
			set.append(label);
		}
		card.append(set);
		const actions = el('div', 'flow-actions');
		actions.append(guarded(next, () => api.flow({ action: 'pick', id: pickChoice })));
		card.append(actions);
	}

	function renderGate(card, view, api) {
		const flow = view.flow;
		const ms = flow.workshops.find((workshop) => workshop.id === 'microsoft');
		head(card, { count: 'Microsoft workshop', title: ms ? ms.label : 'Microsoft workshop' });
		const note = el('div', 'flow-note');
		note.append(glyph('info'), el('p', null, 'For Microsoft employees: sign in with your Microsoft account to continue.'));
		card.append(note);
		card.append(el('p', 'flow-lede', 'The agent opens GitHub\'s sign-in page in your browser. Sign in with your Microsoft work account on GitHub (its username ends in an underscore and a short code). Then this page continues to the Microsoft setup, the same one as always.'));
		const status = el('p', `gate-status${flow.gate.ok ? ' is-ok' : ''}`);
		status.setAttribute('role', 'status');
		status.append(flow.gate.ok ? glyph('check', 'present-check') : spinner());
		status.append(el('span', null, flow.gate.ok ? `Signed in: ${flow.gate.detail}.` : 'Waiting for your Microsoft sign-in.'));
		card.append(status);
		const actions = el('div', 'flow-actions');
		actions.append(guarded(button('Back', { back: true }), () => api.flow({ action: 'step', step: 'pick' })));
		if (!flow.gate.ok) {
			actions.append(guarded(button('Check again'), () => api.check()));
		}
		actions.append(guarded(button('Continue to the Microsoft setup', { primary: true, disabled: !flow.gate.ok }), () => api.flow({ action: 'continue' })));
		card.append(actions);
	}

	function point(text) {
		const li = el('li');
		const svg = document.createElementNS(svgNs, 'svg');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('aria-hidden', 'true');
		const mark = document.createElementNS(svgNs, 'path');
		mark.setAttribute('d', 'M3.5 8.2l3 3 6-6.6');
		mark.setAttribute('stroke-width', '1.6');
		mark.setAttribute('stroke-linecap', 'round');
		mark.setAttribute('stroke-linejoin', 'round');
		svg.append(mark);
		li.append(svg, el('span', null, text));
		return li;
	}

	function navigation(card, api, { back, next, nextLabel = 'Next', primary = false }) {
		const actions = el('div', 'flow-actions');
		if (back) {
			actions.append(guarded(button('Back', { back: true }), () => api.flow({ action: 'step', step: back })));
		}
		actions.append(guarded(button(nextLabel, { primary: true }), () => (primary ? api.flow({ action: 'confirm' }) : api.flow({ action: 'step', step: next }))));
		card.append(actions);
	}

	function renderReady(card, view, api) {
		const flow = view.flow;
		head(card, { count: countText(flow, 'ready'), title: 'Let\'s get your computer ready for the workshop', lede: 'The next screens show what we\'ll install, how to undo it, and what happens next. Nothing is installed until you click Confirm.' });
		const list = el('ul', 'flow-points');
		const folder = flow.install.folder || '~/ai-first-workshop';
		list.append(
			point(`Everything for the workshop goes in one folder: ${folder}.`),
			point('It takes about 5 to 10 minutes, depending on the Wi-Fi.'),
			point('You never type your computer\'s password. You sign in to GitHub in your browser.'),
		);
		card.append(list);
		navigation(card, api, { back: 'pick', next: 'install' });
	}

	function sizeCell(row) {
		return el('span', 'install-size', row.sizeText);
	}

	function renderInstall(card, view, api) {
		const flow = view.flow;
		const install = flow.install;
		head(card, { count: countText(flow, 'install'), title: 'What we\'ll install', lede: 'The essentials are locked on, so the hands-on part just works. Switch on any extras you want.' });
		const groups = [
			{ id: 'tools', label: 'Tools, only if this computer needs them' },
			{ id: 'workshop', label: 'For the workshop' },
			{ id: 'try', label: 'Try it' },
			{ id: 'optional', label: 'Extras' },
		];
		for (const group of groups) {
			const rows = install.rows.filter((row) => row.group === group.id);
			if (!rows.length) {
				continue;
			}
			const section = el('section', 'install-group');
			const h3 = el('h3', null, group.label);
			h3.id = `install-${group.id}`;
			section.setAttribute('aria-labelledby', h3.id);
			const list = el('ul', 'install-rows');
			for (const row of rows) {
				const li = el('li', `install-row is-${row.state}`);
				const control = el('span', 'control');
				const text = el('span');
				const label = el('span', 'install-label', row.label);
				if (row.state === 'on' || row.state === 'off') {
					const input = el('input', 'switch');
					input.type = 'checkbox';
					input.setAttribute('role', 'switch');
					input.checked = row.state === 'on';
					input.id = `switch-${row.id}`;
					input.dataset.focus = `switch:${row.id}`;
					input.setAttribute('aria-describedby', `reason-${row.id}`);
					input.addEventListener('change', async () => {
						input.disabled = true;
						try {
							await api.flow({ action: 'select', id: row.id, on: input.checked });
							api.announce(`${row.label} ${input.checked ? 'on' : 'off'}.`);
						} catch (error) {
							input.checked = !input.checked;
							api.announce(error.message);
						} finally {
							input.disabled = false;
						}
					});
					control.append(input);
					const forLabel = el('label', 'install-label', row.label);
					forLabel.htmlFor = input.id;
					text.append(forLabel);
				} else if (row.state === 'present') {
					control.append(glyph('check', 'present-check'));
					text.append(label);
				} else {
					const lock = glyph('lock', 'lock');
					control.append(lock);
					control.setAttribute('role', 'img');
					control.setAttribute('aria-label', 'Required, locked on');
					control.title = 'Required, locked on';
					text.append(label);
				}
				const reason = el('span', 'install-reason', row.reason);
				reason.id = `reason-${row.id}`;
				text.append(reason);
				if (row.note) {
					text.append(el('span', 'install-note', row.note));
				}
				li.append(control, text, sizeCell(row));
				list.append(li);
			}
			section.append(h3, list);
			card.append(section);
		}
		const total = el('div', `install-total${install.fits === false ? ' is-tight' : ''}`);
		total.setAttribute('aria-live', 'polite');
		total.append(el('strong', null, install.checked ? `About ${install.total.text} on this ${install.where}` : 'Checking what this computer has'));
		if (install.checked) {
			const free = install.free ? ` ${formatGB(install.free)} free here.` : '';
			total.append(el('span', null, install.fits === false
				? `That's more than the space free here.${free} Free up some space first.`
				: `About ${install.total.downloadText} to download.${free}`));
		}
		card.append(total);
		navigation(card, api, { back: 'ready', next: 'uninstall' });
	}

	function formatGB(bytes) {
		const gb = bytes / 1e9;
		return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
	}

	function renderUninstall(card, view, api) {
		const flow = view.flow;
		head(card, { count: countText(flow, 'uninstall'), title: 'How to undo it later' });
		const list = el('ul', 'flow-points');
		flow.uninstall.lines.forEach((line) => list.append(point(line)));
		card.append(list);
		const link = el('div', 'link-card');
		const text = el('span');
		const a = el('a', null, 'The uninstall guide');
		a.href = flow.uninstall.url;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		text.append(a, el('span', 'link-sub', 'Step by step for Mac and Windows, with a video.'));
		const copy = button('Copy link');
		copy.dataset.focus = 'copy:uninstall';
		copy.addEventListener('click', () => api.copy(flow.uninstall.url, copy));
		link.append(text, copy);
		card.append(link);
		navigation(card, api, { back: 'install', next: 'after' });
	}

	function renderAfter(card, view, api) {
		const flow = view.flow;
		head(card, { count: countText(flow, 'after'), title: 'What happens after you click Confirm' });
		const list = el('ol', 'after-list');
		flow.after.forEach((line) => list.append(el('li', null, line)));
		card.append(list);
		navigation(card, api, { back: 'uninstall', nextLabel: 'Confirm', primary: true });
	}

	const RENDERERS = { pick: renderPick, gate: renderGate, ready: renderReady, install: renderInstall, uninstall: renderUninstall, after: renderAfter };

	function fillHero(hero, meta) {
		hero.querySelector('.hero-subtitle').textContent = meta.subtitle || '';
		hero.querySelector('.hero-title').textContent = meta.title || 'Workshop setup';
		hero.querySelector('.hero-presenter').textContent = meta.presenter || '';
	}

	function render(view, api) {
		const root = document.getElementById('flow');
		const hero = root.querySelector('.hero');
		const card = root.querySelector('.flow-card');
		const flow = view.flow;
		document.documentElement.dataset.path = 'ai-first';
		root.hidden = false;
		fillHero(hero, view.meta || {});
		const wasConfirmed = root.classList.contains('is-confirmed');
		root.classList.toggle('is-confirmed', flow.confirmed);
		if (flow.confirmed) {
			if (played && !wasConfirmed) {
				window.SetupWelcome?.still(root);
			}
			lastSignature = null;
			return;
		}
		const signature = JSON.stringify({ step: flow.step, pick: flow.pick, gate: flow.gate, install: flow.install, selections: flow.selections });
		if (signature === lastSignature) {
			return;
		}
		lastSignature = signature;
		const active = document.activeElement?.dataset?.focus || null;
		const stepChanged = flow.step !== lastStep;
		const step = el('div', `flow-step${stepChanged && lastStep !== null && !reduced.matches ? ' is-entering' : ''}`);
		(RENDERERS[flow.step] || renderPick)(step, view, api);
		card.replaceChildren(step);
		if (stepChanged) {
			if (lastStep !== null) {
				document.getElementById('flow-title')?.focus({ preventScroll: true });
				card.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
			}
			lastStep = flow.step;
		} else if (active) {
			const again = [...card.querySelectorAll('[data-focus]')].find((node) => node.dataset.focus === active);
			again?.focus({ preventScroll: true });
		}
	}

	// The welcome animation, once per open; the settled band when motion is off or it already played.
	async function start(view, api) {
		const root = document.getElementById('flow');
		if (!root || !window.SetupWelcome) {
			return;
		}
		// The kit's guide: mount once the fonts are in, so the names' line boxes are final.
		if (document.fonts?.ready) {
			await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
		}
		// The rise plays once per open; the calm loop runs on every showing until Confirm.
		const ambient = !reduced.matches && !view.flow?.confirmed;
		const motion = !!view.intro?.play && ambient;
		if (view.intro?.play) {
			api.post('/api/intro').catch(() => {});
		}
		await window.SetupWelcome.play(root, { motion, ambient });
		played = true;
	}

	window.SetupFlow = { render, start };
})();
