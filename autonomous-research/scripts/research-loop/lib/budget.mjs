// The budget check every launch goes through. Pure functions over the study, its ledger and a cost quote, so they
// can be tested without spending anything.
//
// Default rules, set per study in study.json's budget: at most $250 per round per arm, at most 3 rounds per study,
// at most $1,000 for the program, an absolute ceiling and not a target. Refuse when the all-in cost is over a cap or
// cannot be computed, and when a cap itself is missing or not a positive number.
// The all-in cost is the platform's own number: User Interviews' expected cost (incentives x count + processing
// fees + recruit fees) plus Outset's recruitment estimate (zero for self-recruitment, verified per launch), plus a
// tax allowance because User Interviews quotes "+ applicable taxes".

export function committedSpend(ledger) {
	return ledger.entries.filter(e => e.type === 'launch').reduce((s, e) => s + Number(e.cost_usd_with_allowance ?? e.cost_usd ?? 0), 0);
}

// A platform number, or NaN when it is missing. Number(null) and Number('') are 0, which would turn an unknown cost
// into a free one.
const num = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

/**
 * quote: { ui: { finalCost, incentiveAmount, requestedParticipants, totalProcessingFee, totalRecruitFees } | null,
 *          outset: { mode: 'self' | 'panel', recruitment_usd: number | null, evidence } | null }
 */
export function allInCost(quote, taxAllowance = 0.1) {
	const problems = [];
	const ui = quote?.ui;
	const outset = quote?.outset;
	if (!ui || !Number.isFinite(num(ui.finalCost))) {
		problems.push('User Interviews expected cost is unknown');
	}
	if (ui && (!Number.isFinite(num(ui.incentiveAmount)) || !Number.isFinite(num(ui.requestedParticipants)))) {
		problems.push('User Interviews incentive or participant count is unknown');
	}
	if (!outset || !Number.isFinite(num(outset.recruitment_usd))) {
		problems.push('Outset recruitment cost is unknown');
	}
	if (ui && Number.isFinite(num(ui.finalCost))) {
		const recomputed = num(ui.incentiveAmount) * num(ui.requestedParticipants) + Number(ui.totalProcessingFee ?? 0) + Number(ui.totalRecruitFees ?? 0);
		if (Number.isFinite(recomputed) && Math.abs(recomputed - num(ui.finalCost)) > 0.01) {
			problems.push(`User Interviews cost does not add up (${ui.finalCost} quoted, ${recomputed} from its parts)`);
		}
	}
	if (problems.length) {
		return { known: false, problems };
	}
	const base = Number(ui.finalCost) + Number(outset.recruitment_usd);
	return {
		known: true,
		base_usd: round2(base),
		with_allowance_usd: round2(base * (1 + taxAllowance)),
		parts: {
			ui_incentives: Number(ui.incentiveAmount) * Number(ui.requestedParticipants),
			ui_processing: Number(ui.totalProcessingFee ?? 0),
			ui_recruit: Number(ui.totalRecruitFees ?? 0),
			outset_recruitment: Number(outset.recruitment_usd),
			tax_allowance: round2(base * taxAllowance),
		},
		count: Number(ui.requestedParticipants),
	};
}

export function checkLaunch({ study, ledger, round, arm, cost }) {
	const caps = { ...ledger.caps, ...study.budget };
	const reasons = [];
	const capOk = v => Number.isFinite(Number(v)) && Number(v) > 0 && v !== null && v !== '';
	for (const k of ['per_round_per_arm_usd', 'program_cap_usd', 'max_rounds']) {
		if (!capOk(caps[k])) {
			reasons.push(`cap ${k} is missing or invalid (${JSON.stringify(caps[k])})`);
		}
	}
	if (!cost?.known) {
		reasons.push(`cost unknown: ${(cost?.problems ?? ['no quote']).join('; ')}`);
	}
	if (Number(round) > Number(caps.max_rounds)) {
		reasons.push(`round ${round} is over the ${caps.max_rounds} round limit`);
	}
	if (ledger.entries.some(e => e.type === 'launch' && Number(e.round) === Number(round) && e.arm === arm)) {
		reasons.push(`round ${round} arm ${arm} was already launched`);
	}
	const committed = committedSpend(ledger);
	if (cost?.known) {
		if (cost.with_allowance_usd > Number(caps.per_round_per_arm_usd)) {
			reasons.push(`this launch costs up to $${cost.with_allowance_usd} with the tax allowance, over the $${caps.per_round_per_arm_usd} per-round cap`);
		}
		if (committed + cost.with_allowance_usd > Number(caps.program_cap_usd)) {
			reasons.push(`committed $${round2(committed)} plus up to $${cost.with_allowance_usd} is over the $${caps.program_cap_usd} program cap`);
		}
		const maxCount = Number(caps.max_participants_per_arm ?? study.criteria?.finish_line?.participants_per_round ?? 5);
		if (!(cost.count > 0) || cost.count > maxCount) {
			reasons.push(`participant count ${cost.count} is outside 1 to ${maxCount} per arm`);
		}
	}
	return { ok: reasons.length === 0, reasons, committed_usd: round2(committed) };
}

const round2 = n => Math.round(n * 100) / 100;
