// The page shell. The checklist itself is drawn by web/app.js from /api/state, with textContent only.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// The codicon "refresh" glyph (microsoft/vscode-codicons, CC BY 4.0), so the button reads like VS Code's.
const REFRESH_GLYPH = 'M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z';

export function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function renderPage({ title }) {
	const safeTitle = escapeHtml(title);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${safeTitle}</title>
<link rel="stylesheet" href="/app.css">
<script src="/intro.js" defer></script>
<script src="/app.js" defer></script>
</head>
<body>
<div id="intro" class="intro" hidden>
	<canvas class="intro-glow" aria-hidden="true"></canvas>
	<canvas class="intro-field" aria-hidden="true"></canvas>
	<div class="intro-lines" aria-hidden="true"></div>
	<button type="button" class="intro-skip">Skip intro</button>
</div>
<main id="main" class="page" tabindex="-1">
	<section class="sim" aria-label="Simulation" hidden>
		<p class="sim-text"><span class="sim-tag">Simulation</span> <span class="sim-desc"></span></p>
		<div class="sim-actions">
			<button type="button" class="sim-play" hidden>Pause</button>
			<button type="button" class="sim-replay">Replay</button>
		</div>
	</section>
	<header class="masthead">
		<div class="band" hidden>
			<canvas class="band-field" aria-hidden="true"></canvas>
			<div class="band-text">
				<p class="band-subtitle"></p>
				<p class="band-title"></p>
				<p class="band-presenter"></p>
			</div>
		</div>
		<div class="heading-row">
			<h1 id="page-title" tabindex="-1">${safeTitle}</h1>
			<button type="button" class="refresh" title="Run the setup check again"><svg class="refresh-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="${REFRESH_GLYPH}"/></svg><span>Refresh</span></button>
		</div>
		<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" aria-labelledby="progress-text"><span class="progress-fill"></span></div>
		<p class="summary"><span id="progress-text">Checking your setup</span><span class="now"></span><span class="checked"></span></p>
		<p class="lede">Your agent works through this list with you. Green checks are ready. When something needs you, it says exactly what to do. To pick up where you left off, say "continue my setup" in the chat.</p>
		<p class="check-error" hidden></p>
	</header>
	<div class="groups"></div>
	<aside class="later" hidden><h2>At the workshop</h2><p class="later-text"></p></aside>
	<div class="sr-only" role="status" aria-live="polite" id="live"></div>
	<noscript><p>This checklist needs JavaScript to show your setup.</p></noscript>
</main>
</body>
</html>
`;
}
