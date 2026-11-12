// The page shell. The checklist itself is drawn by web/app.js from /api/state, with textContent only.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// The codicon "refresh" glyph (microsoft/vscode-codicons, CC BY 4.0), so the button reads like VS Code's.
const REFRESH_GLYPH = 'M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z';

// The welcome teaches the two status icons the list uses (web/app.js draws the same ones), plus the codicon
// "workspace-trusted" shield for the line about safety.
const DONE_ICON = '<svg class="icon icon-done" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" class="fill"/><path d="M5 8.2l2 2 4-4.4" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="mark"/></svg>';
const NEEDS_YOU_ICON = '<svg class="icon icon-needs-you" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" fill="none" stroke-width="1.2" class="line"/><circle cx="8" cy="8" r="3" class="fill"/></svg>';
const SHIELD_ICON = '<svg class="icon icon-shield" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M13.4 3C11.563 3 9.91401 2.667 8.42601 1.176C8.30901 1.059 8.15501 1 8.00101 1C7.84801 1 7.69501 1.059 7.57801 1.176C6.08601 2.667 4.43601 3 2.60101 3C2.27001 3 2.00101 3.269 2.00101 3.6V7.202C2.00101 11.064 3.97101 13.689 7.81101 14.97C7.87301 14.991 7.93701 15.001 8.00101 15.001C8.06501 15.001 8.12901 14.991 8.19101 14.97C12.032 13.69 14.001 11.064 14.001 7.202V3.6C14.001 3.269 13.731 3 13.4 3ZM13 7.201C13 10.597 11.364 12.815 8.00001 13.977C4.63601 12.815 3.00001 10.597 3.00001 7.201V3.995C4.57901 3.956 6.35201 3.646 8.00101 2.152C9.64701 3.645 11.421 3.955 13 3.995V7.201ZM7.49901 8.793L10.145 6.147C10.243 6.049 10.371 6.001 10.499 6.001C10.775 6.001 10.999 6.225 10.999 6.501C10.999 6.629 10.95 6.757 10.853 6.855L7.85301 9.855C7.75501 9.953 7.62701 10.001 7.49901 10.001C7.37101 10.001 7.24301 9.952 7.14501 9.855L5.64501 8.355C5.54701 8.257 5.49901 8.129 5.49901 8.001C5.49901 7.725 5.72301 7.501 5.99901 7.501C6.12701 7.501 6.25501 7.55 6.35301 7.647L7.49901 8.793Z"/></svg>';

// The second step of the welcome: what only the person does, for their OS. The agent runs the commands.
const SIGN_IN = 'Sign in when your browser opens. For GitHub, you paste a short code from this list.';
const ONLY_YOU = {
	mac: [SIGN_IN, 'Type your Mac password when an installer asks for it.', 'Turn on Computer Use: send /computer on in the chat, then allow it in System Settings.'],
	win: [SIGN_IN, 'Click Yes when Windows asks to let an installer make changes.', 'Turn on Computer Use: send /computer on in the chat, then click Turn On.'],
	other: [SIGN_IN, 'Type your password when an installer asks for it.', 'Turn on Computer Use: send /computer on in the chat, then click Turn On.'],
};
const onlyYouLists = () => Object.entries(ONLY_YOU)
	.map(([os, lines]) => `<ul class="welcome-list" data-os="${os}" hidden>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`)
	.join('\n\t\t\t\t');

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
	<div class="intro-stage">
		<div class="intro-lines" aria-hidden="true"></div>
		<section class="welcome" hidden>
			<div class="welcome-step" data-step="1">
				<p class="welcome-label">Welcome</p>
				<h2 class="welcome-title" id="welcome-title-1" tabindex="-1">Let's get your computer ready for the workshop</h2>
				<ul class="welcome-points">
					<li>${DONE_ICON}<span>Your agent checks what's already here, shows you its plan in the chat, then sets up the rest.</span></li>
					<li>${NEEDS_YOU_ICON}<span>When it needs you, this list says exactly what to do.</span></li>
					<li>${SHIELD_ICON}<span>Everything comes from Microsoft, GitHub and other official sources. You type your own passwords and sign in yourself, so the agent never sees them.</span></li>
				</ul>
				<div class="welcome-actions">
					<span class="welcome-count">1 of 2</span>
					<button type="button" class="welcome-next primary">Next</button>
				</div>
			</div>
			<div class="welcome-step" data-step="2" hidden>
				<p class="welcome-label">Before you start</p>
				<h2 class="welcome-title" id="welcome-title-2" tabindex="-1">A few steps need you</h2>
				<p class="welcome-lede">The agent runs the commands for you. You'll only need to:</p>
				${onlyYouLists()}
				<div class="welcome-actions">
					<span class="welcome-count">2 of 2</span>
					<button type="button" class="welcome-back">Back</button>
					<button type="button" class="welcome-go primary">Show my checklist</button>
				</div>
			</div>
		</section>
	</div>
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
