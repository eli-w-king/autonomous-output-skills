/* Lab switcher pill for the AI-First edition of autonomous-variations. Copy it into the project's static files and
 * load it once, after setting the list (today's version first):
 *
 *   window.labVariations = [
 *     { id: '0', name: 'Today', idea: 'The current version' },
 *     { id: 'calm', name: 'Minimal and calm', idea: 'Only the tools people use most' },
 *   ];
 *   window.labParam = 'v'; // optional: the URL parameter that picks a variation
 *
 * It shows a small pill with the current variation and a menu of all of them, and steps through them with [ and ].
 * Picking one reloads the page with the parameter set. It stays hidden with ?embed=1 or fewer than two variations. */
(() => {
	const list = Array.isArray(window.labVariations) ? window.labVariations : [];
	const param = window.labParam || 'v';
	const here = new URL(location.href);
	if (list.length < 2 || here.searchParams.get('embed') === '1' || document.getElementById('lab-pill')) {
		return;
	}
	const ids = list.map(v => String(v.id));
	const at = Math.max(0, ids.indexOf(here.searchParams.get(param) ?? ids[0]));
	const go = index => {
		const next = new URL(location.href);
		next.searchParams.set(param, ids[(index + ids.length) % ids.length]);
		location.assign(next.href);
	};
	const el = (tag, text, style) => {
		const node = document.createElement(tag);
		if (text) { node.textContent = text; }
		if (style) { node.style.cssText = style; }
		return node;
	};

	const css = el('style', `
#lab-pill { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; font: 13px/1.35 system-ui, sans-serif; color: #1f2328; }
#lab-pill button { font: inherit; color: inherit; cursor: pointer; }
#lab-pill > button { display: flex; gap: 8px; align-items: center; min-height: 36px; padding: 0 14px; border: 1px solid #d0d7de; border-radius: 999px; background: #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, .12); }
#lab-pill ul { position: absolute; left: 0; bottom: 44px; min-width: 260px; max-width: 360px; margin: 0; padding: 6px; list-style: none; border: 1px solid #d0d7de; border-radius: 12px; background: #fff; box-shadow: 0 8px 24px rgba(0, 0, 0, .16); }
#lab-pill li button { display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 8px; background: none; text-align: left; }
#lab-pill li button:hover, #lab-pill li button[aria-current="true"] { background: #f0f3f6; }
#lab-pill small { display: block; color: #59636e; }
#lab-pill button:focus-visible { outline: 2px solid #0969da; outline-offset: 2px; }`);

	const root = el('div');
	root.id = 'lab-pill';
	const toggle = el('button');
	toggle.type = 'button';
	toggle.title = 'Variations: press [ and ] to step through';
	toggle.setAttribute('aria-haspopup', 'true');
	toggle.setAttribute('aria-expanded', 'false');
	toggle.append(el('b', ids[at]), el('span', list[at].name || ''), el('span', `${at + 1}/${list.length}`, 'color: #59636e'));

	const menu = el('ul');
	menu.hidden = true;
	list.forEach((v, i) => {
		const item = el('button');
		item.type = 'button';
		if (i === at) { item.setAttribute('aria-current', 'true'); }
		item.append(el('span', `${v.id}  ${v.name || ''}`));
		if (v.idea) { item.append(el('small', v.idea)); }
		item.addEventListener('click', () => go(i));
		const row = el('li');
		row.append(item);
		menu.append(row);
	});

	const open = show => {
		menu.hidden = !show;
		toggle.setAttribute('aria-expanded', String(show));
		if (show) { (menu.querySelector('[aria-current="true"]') || menu.querySelector('button')).focus(); }
	};
	toggle.addEventListener('click', () => open(menu.hidden));
	document.addEventListener('click', e => { if (!root.contains(e.target)) { open(false); } });
	document.addEventListener('keydown', e => {
		if (e.key === 'Escape' && !menu.hidden) {
			open(false);
			toggle.focus();
			return;
		}
		const target = e.target;
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey
			|| (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))) {
			return;
		}
		if (e.key === ']' || e.key === '[') {
			e.preventDefault();
			go(at + (e.key === ']' ? 1 : -1));
		}
	});

	root.append(menu, toggle);
	const mount = () => document.body.append(css, root);
	if (document.body) { mount(); } else { addEventListener('DOMContentLoaded', mount); }
})();
