// Template for one continuous demo take, run inside demo-driver.mjs:
//   curl -s localhost:47400/run -d '{"module":"/abs/path/take.mjs","dir":"/abs/path/take-1"}'
//
// Copy it per demo and replace the beats. Keep the structure: preflight, lead-in hold, deliberate
// beats with holds long enough to read, marks around every idle wait (for speed-ramp.mjs), a final
// hold, stop. One take, no cuts. Selectors below are the ones that held up in past Code OSS demos;
// re-check them against the current build (`/eval`) before relying on them.

export default async function take(h, body) {
	const { page, sleep, hold, glide, click, clickRow, focusChatInput, typeText, waitFor, preflight, mark, startRecording, stopRecording, press } = h;

	// 1. Clean state BEFORE recording: no toasts, hovers, menus, dialogs, or stale overlays.
	await press('Escape');
	await press('F7'); // notifications.clearAll (bound by launch-demo-oss.mjs)
	const dirty = await preflight();
	if (dirty.length) {
		throw new Error(`not clean, fix before recording: ${JSON.stringify(dirty)}`);
	}

	// 2. Record. Calm lead-in with the pointer parked in empty space.
	await startRecording(body.dir);
	await glide(1100, 640, 400);
	await hold(2.5);

	// 3. Beats. Click real controls the way a person would (no search when the item is visible).
	await click('.chat-input-picker-split-primary'); // model picker (the primary half of the split pill)
	await hold(1.2);
	await clickRow('GPT-6.1 Sol');
	await hold(1.0);

	await focusChatInput();
	await typeText('Find a listener leak in the voice mode code.');
	await hold(0.8);
	await press('Enter');

	// 4. Idle wait: mark it so it can be fast-forwarded in place later, never cut.
	mark('wait_start');
	await waitFor({ text: 'Found it', timeout: 10 * 60 * 1000 });
	mark('wait_end');
	await hold(1.5);

	// 5. Payoff: hold long enough to read, then a calm lead-out.
	await glide(1250, 700, 700);
	await hold(4);
	await hold(2.5);
	return stopRecording();
}
