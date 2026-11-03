// One DM to the study's owner per round, the first time the round's Outset study stops at an organization admin's
// approval (publish_study refused, approval_required). It says the study is ready, gives its link and the one step
// only the owner can take (Submit for review, in Outset's web app), and what happens after approval, so the study can
// be submitted while people are at work instead of waiting overnight. The agent sends it with its chat tool. This
// module decides when one is due, writes the text, and records the claim and the send in the round's `gate_dm` in
// study.json, so no round ever gets two.
import { updateStudy, addHistory, armLabel, capitalize } from './state.mjs';
import { CONFIG } from './config.mjs';

const money = n => {
	const v = Number(n);
	return `$${v.toLocaleString('en-US', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const roundOf = (study, n) => (study.rounds ?? []).find(r => Number(r.n) === Number(n));

/** Arms of a round that are not launched and wait on an admin's approval before Outset publishes them. */
export function gatedArms(ledger, round) {
	return (round?.arms ?? []).filter(a => {
		if (a.launched_at) {
			return false;
		}
		// The gate check's reading wins once there is one; until then, a publish the launcher saw refused for approval.
		if (a.outset_gate?.state) {
			return a.outset_gate.state === 'awaiting-admin-approval';
		}
		return (ledger?.entries ?? []).some(e => e.type === 'blocked' && Number(e.round) === Number(round.n) && e.arm === a.arm && /approval/i.test(e.reason ?? ''));
	});
}

/**
 * The current round's DM: `due` (send it), `check` (claimed by an earlier run but not recorded as sent: look in the
 * channel before anything else), `sent`, or `none` (no arm of the round waits on an admin).
 */
export function gateDmStatus(study, ledger) {
	const round = study.rounds?.at(-1);
	if (!round) {
		return { status: 'none', reason: 'no round' };
	}
	const dm = round.gate_dm ?? {};
	if (dm.sent_at) {
		return { status: 'sent', round: round.n, sent_at: dm.sent_at };
	}
	const arms = gatedArms(ledger, round).map(a => a.arm);
	if (!arms.length) {
		return { status: 'none', round: round.n, reason: 'no arm of this round waits on an admin\'s approval' };
	}
	return dm.claimed_at ? { status: 'check', round: round.n, arms, claimed_at: dm.claimed_at } : { status: 'due', round: round.n, arms };
}

/** What happens after approval, in one sentence, with the cost the launcher already checked for each waiting arm. */
export function afterApproval(study, ledger, round, { nextRun = CONFIG.gateDm.nextRun } = {}) {
	const arms = gatedArms(ledger, round);
	const costs = arms.map(a => [...(ledger?.entries ?? [])].reverse().find(e => e.type === 'check' && Number(e.round) === Number(round.n) && e.arm === a.arm)?.cost).filter(c => c?.known);
	const many = arms.length > 1;
	const cap = study.budget?.per_round_per_arm_usd;
	let cost = '';
	if (costs.length && costs.length === arms.length) {
		const base = costs.reduce((t, c) => t + Number(c.base_usd), 0);
		const top = costs.reduce((t, c) => t + Number(c.with_allowance_usd), 0);
		cost = `: ${costs[0].count} participants${many ? ' each' : ''}, ${money(base)}${many ? ' in total' : ''} (up to ${money(top)} with tax)${cap ? `, under the ${money(cap)} cap${many ? ' per study' : ''}` : ''}`;
	}
	return `Once an admin approves ${many ? 'each one' : 'it'}, the loop starts recruiting in User Interviews on its next run${nextRun ? ` (${nextRun})` : ''}, after checking the participant link and every image${cost}.`;
}

/** The DM, exactly as it should be sent. Its first line names the round and the study, so a later run can find it. */
export function gateDmText(study, ledger, roundN = study.rounds?.at(-1)?.n, opts = {}) {
	const round = roundOf(study, roundN);
	if (!round) {
		throw new Error(`no round ${roundN}`);
	}
	const arms = gatedArms(ledger, round);
	const what = Number(round.n) > 1 ? `the round ${round.n} retest of "${study.title}"` : `round ${round.n} of "${study.title}"`;
	const lines = [`Research loop: ${what} is ready in Outset, and it needs an admin's approval before it can go live.`, ''];
	if (arms.length > 1) {
		lines.push('1. Click Submit for review on each one in Outset:');
		arms.forEach(a => lines.push(`   ${capitalize(armLabel(study, a))}: ${a.outset?.study_url ?? '(no link recorded)'}`));
	} else {
		lines.push(`1. Click Submit for review on it in Outset: ${arms[0]?.outset?.study_url ?? '(no link recorded)'}`);
	}
	lines.push(`2. ${afterApproval(study, ledger, round, opts)}`, '', 'Nothing is spent until then.');
	return lines.join('\n');
}

/** The study's "Needs you" line for an arm waiting at the gate. launch.mjs adds it on a refusal and drops it on launch. */
export const gateNeedsPrefix = roundN => `Round ${roundN} needs an admin's approval in Outset`;
export const gateNeedsLine = (study, roundN, arm) =>
	`${gateNeedsPrefix(roundN)} for ${armLabel(study, arm)}: click Submit for review at ${arm.outset?.study_url ?? '(no link recorded)'}. Recruiting starts on the first run after approval.`;

/** Claim the round's DM before sending it. Only one caller ever gets `claimed: true` for a round. */
export async function claimGateDm(slug, roundN, { by = 'unknown' } = {}) {
	return updateStudy(slug, s => {
		const r = roundOf(s, roundN);
		if (!r) {
			throw new Error(`no round ${roundN}`);
		}
		const dm = r.gate_dm ?? {};
		if (dm.sent_at || dm.claimed_at) {
			return { claimed: false, reason: dm.sent_at ? `already sent at ${dm.sent_at}` : `already claimed at ${dm.claimed_at} (${dm.claimed_by ?? 'unknown'})` };
		}
		r.gate_dm = { ...dm, claimed_at: new Date().toISOString(), claimed_by: by };
		addHistory(s, `round ${r.n}: claimed the one DM about Outset approval (${by})`);
		return { claimed: true };
	});
}

/** Record that the round's DM went out. A round records one send, ever. */
export async function recordGateDmSent(slug, roundN, { ts = null, permalink = null, channel = CONFIG.gateDm.channel, at = new Date().toISOString(), by = 'unknown' } = {}) {
	if (Number.isNaN(Date.parse(at))) {
		throw new Error(`not a time: "${at}"`);
	}
	return updateStudy(slug, s => {
		const r = roundOf(s, roundN);
		if (!r) {
			throw new Error(`no round ${roundN}`);
		}
		const dm = r.gate_dm ?? {};
		if (dm.sent_at) {
			return { recorded: false, reason: `already recorded as sent at ${dm.sent_at}` };
		}
		const sentAt = new Date(at).toISOString();
		r.gate_dm = { ...dm, claimed_at: dm.claimed_at ?? sentAt, sent_at: sentAt, channel, ts, permalink, sent_by: by };
		addHistory(s, `round ${r.n}: sent the one DM about Outset approval`, permalink ? { permalink } : {});
		return { recorded: true };
	});
}

/** Drop a claim whose send never happened (checked in the channel), so the next caller can claim and send. */
export async function releaseGateDm(slug, roundN, { reason } = {}) {
	if (!reason) {
		throw new Error('say why the claim is released (--reason)');
	}
	return updateStudy(slug, s => {
		const r = roundOf(s, roundN);
		if (!r) {
			throw new Error(`no round ${roundN}`);
		}
		const dm = r.gate_dm ?? {};
		if (dm.sent_at) {
			return { released: false, reason: `sent at ${dm.sent_at}; a sent DM is never released` };
		}
		if (!dm.claimed_at) {
			return { released: false, reason: 'not claimed' };
		}
		const released = [...(dm.released ?? []), { claimed_at: dm.claimed_at, at: new Date().toISOString(), reason }];
		r.gate_dm = { released };
		addHistory(s, `round ${r.n}: released an unsent claim on the Outset approval DM (${reason})`);
		return { released: true };
	});
}
