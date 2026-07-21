(() => {
	'use strict';

	/* ------------------------------------------------------------------ *
	 * 48 manual design tasks. The same cards are re-sorted as you scroll.
	 * ------------------------------------------------------------------ */
	const tasks = [
		'Capture the idea', 'Name the user outcome', 'Define success', 'Set constraints',
		'Clarify scope', 'Identify stakeholders', 'Choose the trigger', 'Set the decision question',
		'Reproduce the behavior', 'Trace the interaction', 'Inspect the source', 'Read prior research',
		'Review telemetry', 'Read the issues', 'Map the current flow', 'Note assumptions',
		'Generate directions', 'Sketch the task flow', 'Compare options', 'Identify tradeoffs',
		'Critique a direction', 'Select variants', 'Refine the copy', 'Check accessibility',
		'Create a worktree', 'Build variant A', 'Build variant B', 'Compile the app',
		'Launch Code OSS', 'Drive the interaction', 'Capture a screenshot', 'Fix the defect',
		'Record a demo', 'Encode the walkthrough', 'Write study questions', 'Choose the audience',
		'Open Playwright', 'Build the study', 'Preview the study', 'Launch the study',
		'Participant responds', 'Download transcripts', 'Download the videos', 'Synthesize findings',
		'Consult telemetry', 'Triangulate evidence', 'Draft the issue', 'Prepare the PR'
	];

	const phaseNames = [
		'FRAME THE WORK', 'UNDERSTAND THE PROBLEM', 'EXPLORE & CHOOSE',
		'BUILD & PROVE', 'RESEARCH & LEARN', 'DECIDE & DOCUMENT'
	];

	const section = document.getElementById('diagramScroll');
	const cardsLayer = document.getElementById('sortCards');
	const regionsLayer = document.getElementById('sortRegions');
	const eyebrowEl = document.getElementById('sortEyebrow');
	const titleEl = document.getElementById('sortTitle');
	const stepsEl = document.getElementById('sortSteps');

	const cards = tasks.map((task, index) => {
		const card = document.createElement('div');
		card.className = 'sort-card';
		card.textContent = task;
		cardsLayer.appendChild(card);
		return card;
	});

	/* ------------------------------------------------------------------ *
	 * Layout helpers. All coordinates are percentages of the stage.
	 * ------------------------------------------------------------------ */
	const rect = (x, y, w, h) => ({ x, y, w, h });

	function cells(ids, area, columns, top, bottom = 4) {
		const positions = {};
		const rows = Math.ceil(ids.length / columns);
		const gx = 0.8, gy = 0.6;
		const w = (area.w - gx * (columns - 1)) / columns;
		const h = (area.h - top - bottom - gy * (rows - 1)) / rows;
		ids.forEach((id, i) => {
			const column = Math.floor(i / rows);
			const row = i % rows;
			positions[id] = rect(
				area.x + column * (w + gx),
				area.y + top + row * (h + gy),
				w, h
			);
		});
		return positions;
	}

	/* Top-aligned list with a fixed row rhythm (used for the labelled states). */
	function stack(ids, area, columns, top, rowH) {
		const positions = {};
		const gx = 0.8;
		const rows = Math.ceil(ids.length / columns);
		const w = (area.w - gx * (columns - 1)) / columns;
		ids.forEach((id, i) => {
			const column = Math.floor(i / rows);
			const row = i % rows;
			positions[id] = rect(
				area.x + column * (w + gx),
				area.y + top + row * rowH,
				w, rowH - 0.9
			);
		});
		return positions;
	}

	/* States 1 & 2 — six columns, optionally boxed and labelled. */
	function phaseState(grouped) {
		const positions = {};
		const regions = [];
		for (let phase = 0; phase < 6; phase += 1) {
			const box = rect(phase * 16.7, 0, 15.6, 100);
			const ids = Array.from({ length: 8 }, (_, i) => phase * 8 + i);
			Object.assign(positions, cells(ids, box, 1, 3));
			if (grouped) {
				Object.assign(positions, stack(ids, box, 1, 13, 8.4));
				regions.push({ box, label: phaseNames[phase] });
			}
		}
		return { positions, regions, plainCards: grouped };
	}

	/* Shared five-region geometry for the system (states 3 & 4). */
	const sysBoxes = {
		intent: rect(0, 0, 13, 100),
		make: rect(16, 0, 33, 100),
		feedback: rect(52, 0, 11, 100),
		decide: rect(66, 0, 20, 100),
		decision: rect(89, 0, 11, 100)
	};
	const sysOrder = ['intent', 'make', 'feedback', 'decide', 'decision'];

	function sysPositions(height) {
		const b = key => ({ ...sysBoxes[key], h: height });
		const decideIds = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43, 44, 45, 46];
		return {
			...stack([0, 1, 2, 3, 4, 5], b('intent'), 1, 17, 8.4),
			...stack(Array.from({ length: 24 }, (_, i) => i + 6), b('make'), 3, 17, 8.4),
			...stack([40], b('feedback'), 1, 46, 8.4),
			...stack(decideIds, b('decide'), 2, 17, 8.4),
			...stack([47], b('decision'), 1, 46, 8.4)
		};
	}

	/* State 3 — one continuous system, cards shown as clean lists. */
	function systemState() {
		const labels = {
			intent: ['HUMAN INTENT', 'You set the goal', 'human'],
			make: ['AUTOMATION', 'Design, build, record, research', 'skill'],
			feedback: ['REAL USERS', 'Qualitative feedback', 'human'],
			decide: ['AUTOMATION', 'Synthesis, quant data, iterate', 'skill'],
			decision: ['HUMAN DECISION', 'Documented issue and PR', 'human']
		};
		const regions = sysOrder.map(key => ({
			box: { ...sysBoxes[key], h: 88 },
			label: labels[key][0], title: labels[key][1], kind: labels[key][2]
		}));
		return { positions: sysPositions(100), regions, flow: true, plainCards: true };
	}

	/* State 4 — same shape, titles only, no cards. */
	function codedState() {
		const labels = {
			intent: ['HUMAN', 'Problem to solve', 'human'],
			make: ['AUTOMATION', 'Design · build · record · research', 'skill'],
			feedback: ['HUMAN', 'Qual feedback', 'human'],
			decide: ['AUTOMATION', 'Synthesis · quant data · iterate', 'skill'],
			decision: ['HUMAN', 'Documented issue + engineering ready PR', 'human']
		};
		const regions = sysOrder.map(key => ({
			box: { ...sysBoxes[key], h: 88 },
			role: labels[key][0], title: labels[key][1], kind: labels[key][2]
		}));
		return { positions: sysPositions(100), regions, flow: true, titlesOnly: true, hideCards: true };
	}

	const states = [
		{ eyebrow: 'THE RAW INVENTORY', title: 'Forty-eight tasks. Before any grouping.', ...phaseState(false) },
		{ eyebrow: 'THE OLD WAY', title: 'Same cards. Six phases, one after another.', ...phaseState(true) },
		{ eyebrow: 'THE SAME WORK, REORGANIZED', title: 'One continuous system. People open and close it.', ...systemState() },
		{ eyebrow: 'THE PROCEDURE, CODED', title: 'Five moves. Two of them run themselves.', ...codedState() }
	];

	/* Progress ticks in the head. */
	states.forEach(() => {
		const tick = document.createElement('span');
		stepsEl.appendChild(tick);
	});
	const ticks = [...stepsEl.children];

	/* ------------------------------------------------------------------ *
	 * Rendering
	 * ------------------------------------------------------------------ */
	function chevronCenters() {
		const centers = [];
		for (let i = 0; i < sysOrder.length - 1; i += 1) {
			const a = sysBoxes[sysOrder[i]];
			const b = sysBoxes[sysOrder[i + 1]];
			centers.push((a.x + a.w + b.x) / 2);
		}
		return centers;
	}

	function renderRegions(state) {
		regionsLayer.innerHTML = '';
		state.regions.forEach(region => {
			const el = document.createElement('div');
			el.className = `sort-region ${state.titlesOnly ? 'titles ' : ''}${region.kind || ''}`.trim();
			Object.assign(el.style, {
				left: `${region.box.x}%`, top: `${region.box.y}%`,
				width: `${region.box.w}%`, height: `${region.box.h}%`
			});
			if (state.titlesOnly) {
				el.innerHTML = `<span class="r-role">${region.role || ''}</span><b class="r-title">${region.title}</b>`;
			} else {
				el.innerHTML = `<span class="r-label">${region.label}</span>${region.title ? `<b class="r-title">${region.title}</b>` : ''}`;
			}
			regionsLayer.appendChild(el);
			requestAnimationFrame(() => el.classList.add('visible'));
		});
		if (state.flow) {
			chevronCenters().forEach(cx => {
				const chev = document.createElement('div');
				chev.className = 'sort-chevron';
				chev.textContent = '\u2192';
				Object.assign(chev.style, { left: `${cx}%`, top: '44%' });
				regionsLayer.appendChild(chev);
				requestAnimationFrame(() => chev.classList.add('visible'));
			});
			// Return loop: from the second automation stage back to the first.
			const ret = document.createElement('div');
			ret.className = 'sort-return';
			Object.assign(ret.style, { left: '33%', width: '43%', top: '94%' });
			ret.innerHTML = '<span class="sort-return__head"></span>';
			regionsLayer.appendChild(ret);
			requestAnimationFrame(() => ret.classList.add('visible'));
		}
	}

	let current = -1;
	function setStep(next) {
		next = Math.max(0, Math.min(states.length - 1, next));
		if (next === current) { return; }
		current = next;
		const state = states[next];
		eyebrowEl.textContent = state.eyebrow;
		titleEl.innerHTML = state.title.replace('. ', '.<br />');
		ticks.forEach((tick, i) => tick.classList.toggle('on', i <= next));

		regionsLayer.querySelectorAll('.sort-region, .sort-chevron').forEach(el => el.classList.remove('visible'));
		setTimeout(() => renderRegions(state), 120);

		cardsLayer.classList.toggle('hidden', !!state.hideCards);
		cardsLayer.classList.toggle('plain', !!state.plainCards);
		cards.forEach((card, id) => {
			const box = state.positions[id];
			if (!box) { return; }
			Object.assign(card.style, {
				left: `${box.x}%`, top: `${box.y}%`,
				width: `${box.w}%`, height: `${box.h}%`
			});
		});
	}

	/* ------------------------------------------------------------------ *
	 * Scroll drives the states. The stage is pinned while the tall
	 * section scrolls past; progress maps evenly onto the states.
	 * ------------------------------------------------------------------ */
	section.style.height = `${states.length * 100}vh`;

	let ticking = false;
	function onScroll() {
		if (ticking) { return; }
		ticking = true;
		requestAnimationFrame(() => {
			const rectBox = section.getBoundingClientRect();
			const distance = section.offsetHeight - window.innerHeight;
			const scrolled = Math.min(Math.max(-rectBox.top, 0), distance);
			const progress = distance > 0 ? scrolled / distance : 0;
			const index = Math.min(states.length - 1, Math.floor(progress * states.length));
			setStep(index);
			ticking = false;
		});
	}
	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', () => { current = -1; onScroll(); });

	setStep(0);
	onScroll();

	/* ------------------------------------------------------------------ *
	 * Scroll reveal for the framing sections.
	 * ------------------------------------------------------------------ */
	const io = new IntersectionObserver(entries => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				entry.target.classList.add('in');
				io.unobserve(entry.target);
			}
		});
	}, { threshold: 0.18 });
	document.querySelectorAll('.reveal').forEach(el => io.observe(el));
})();
