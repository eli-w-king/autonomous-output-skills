// Read-only platform state, for checks that compare the ledger with the platforms (confirm.mjs platform). The same
// calls run.mjs and close.mjs make: a User Interviews project's status (GET /api/projects/<id>: currentStatus,
// latestStatusTypeId) and paid count (GET /api/projects/<id>/summary: paidParticipantCount) through its web app's JSON
// API in the loop's signed-in Chrome, and an Outset study's `active` through REST. Nothing here changes anything.
import { uiFetch } from './ui-browser.mjs';
import { outsetRest } from './outset.mjs';

export async function uiProjectRead(page, pid) {
	const p = await uiFetch(page, `/api/projects/${pid}`);
	if (p.status !== 200) {
		throw new Error(`reading User Interviews project ${pid}: HTTP ${p.status}`);
	}
	const s = await uiFetch(page, `/api/projects/${pid}/summary`);
	if (s.status !== 200) {
		throw new Error(`reading User Interviews project ${pid}'s summary: HTTP ${s.status}`);
	}
	const a = p.json?.data?.attributes ?? {};
	return {
		status_id: a.latestStatusTypeId ?? null,
		status: a.currentStatus ?? null,
		paid: s.json?.data?.attributes?.paidParticipantCount ?? null,
		how: `read only: GET /api/projects/${pid} and /api/projects/${pid}/summary in the loop's Chrome`,
	};
}

export async function outsetStudyRead(id) {
	const r = await outsetRest(`/v1/studies/${id}/`);
	if (r.status !== 200) {
		throw new Error(`reading Outset study ${id}: HTTP ${r.status}`);
	}
	return {
		active: typeof r.body?.active === 'boolean' ? r.body.active : null,
		how: 'read only: Outset REST GET /v1/studies/<id>/',
	};
}
