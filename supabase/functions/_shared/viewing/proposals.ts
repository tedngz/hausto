// Scoring the AI operator against the people doing the job.
//
// Every proposal ends one of five ways. APPROVED and REJECTED are an operator
// pressing a button on it. AGREED and CORRECTED are what happens far more
// often: the operator simply does the work, by hand, and the proposal is
// compared with what they did. SUPERSEDED means the request moved on and the
// proposal stopped applying - it says nothing either way and is left out of
// the rate.
//
// Pure, so the scoring is tested - it is the number stage 2 is gated on, and a
// scoring bug would open that gate by accident.

export type ProposalStatus =
  | 'PENDING' | 'APPROVED' | 'AGREED' | 'CORRECTED' | 'REJECTED' | 'SUPERSEDED'
  // Stage 2: run by the AI operator itself, and later marked wrong by a person.
  | 'EXECUTED' | 'FLAGGED';

export interface ProposalRow {
  id: string;
  request_id: string;
  item_id: string | null;
  dedupe_key: string;
  action: string;
  input: Record<string, unknown>;
  status: ProposalStatus;
}

export interface DoneAction {
  action: string;
  itemId: string | null;
  input: Record<string, unknown>;
}

/** Actions that settle a renter-facing proposal: a person answered, closed or waved it off. */
const RENTER_ACTIONS = new Set(['REPLY', 'ACK_REPLIES', 'CANCEL_REQUEST']);

/**
 * Actions on an item that do not decide anything about it. Saving a reply is
 * the start of reading it; recording a number is the start of contacting.
 * Neither agrees with nor contradicts what was proposed.
 */
const PREPARATORY = new Set(['REALTOR_REPLY', 'RECORD_CONTACT']);

/**
 * What an operator's action means for one pending proposal, or null when it
 * has nothing to say about it.
 */
export function settlementFor(p: ProposalRow, done: DoneAction): 'AGREED' | 'CORRECTED' | null {
  if (p.status !== 'PENDING') return null;

  if (p.item_id) {
    if (done.itemId !== p.item_id) return null;
    // An escalation about an item is agreed with by any person acting on it,
    // including the preparatory steps - finding a number is exactly what
    // "no working number, a person has to find one" asked for.
    if (p.action === 'ESCALATE') return 'AGREED';
    if (PREPARATORY.has(done.action)) return null;
    if (done.action !== p.action) return 'CORRECTED';
    if (p.action === 'OUTCOME') return p.input.outcome === done.input.outcome ? 'AGREED' : 'CORRECTED';
    if (p.action === 'NOTIFY_REALTOR') return p.input.decision === done.input.decision ? 'AGREED' : 'CORRECTED';
    return 'AGREED';
  }

  if (p.dedupe_key.startsWith('RENTER:')) {
    if (!RENTER_ACTIONS.has(done.action)) return null;
    if (p.action === 'ESCALATE') return 'AGREED';
    return done.action === p.action ? 'AGREED' : 'CORRECTED';
  }

  if (p.dedupe_key.startsWith('DELIVER:')) {
    if (done.action === 'DELIVER') return p.action === 'DELIVER' ? 'AGREED' : 'CORRECTED';
    if (done.action === 'CANCEL_REQUEST') return 'CORRECTED';
    return null;
  }

  return null;
}

/** Fields an operator may change on approval without it becoming a correction. */
const WORDING = new Set(['message', 'note', 'order']);

/**
 * Approving with edits. Rewording a draft or reordering stops is still
 * agreeing with the proposal - `edited` records it. Changing what the action
 * decides (the outcome, its slots, the price, the decision, the reason) is a
 * correction, whichever button was pressed.
 */
export function approvalOf(proposed: Record<string, unknown>, overrides: Record<string, unknown>): {
  input: Record<string, unknown>;
  status: 'APPROVED' | 'CORRECTED';
  edited: boolean;
} {
  const input = { ...proposed, ...overrides };
  let edited = false;
  let corrected = false;
  for (const [k, v] of Object.entries(overrides)) {
    if (JSON.stringify(proposed[k]) === JSON.stringify(v)) continue;
    if (WORDING.has(k)) edited = true;
    else corrected = true;
  }
  return { input, status: corrected ? 'CORRECTED' : 'APPROVED', edited };
}

export interface AgreementRow {
  action: string;
  status: ProposalStatus;
  edited: boolean;
}

export interface AgreementStats {
  action: string;
  decided: number;
  agreed: number;
  corrected: number;
  rejected: number;
  edited: number;
  /** agreed / decided, or null with nothing decided. */
  rate: number | null;
}

/**
 * Agreement per action. Approved and agreed both count as agreement; pending
 * and superseded are not decisions and are not counted at all.
 */
export function agreementStats(rows: AgreementRow[]): AgreementStats[] {
  const by = new Map<string, AgreementStats>();
  for (const r of rows) {
    // Not decisions by a person: nothing to agree or disagree with. An
    // autonomous action is judged by flags instead (autonomy.ts), and counting
    // it here would let the AI operator raise its own agreement rate.
    if (r.status === 'PENDING' || r.status === 'SUPERSEDED' || r.status === 'EXECUTED' || r.status === 'FLAGGED') continue;
    const s = by.get(r.action) ?? { action: r.action, decided: 0, agreed: 0, corrected: 0, rejected: 0, edited: 0, rate: null };
    s.decided += 1;
    if (r.status === 'APPROVED' || r.status === 'AGREED') s.agreed += 1;
    if (r.status === 'CORRECTED') s.corrected += 1;
    if (r.status === 'REJECTED') s.rejected += 1;
    if (r.edited) s.edited += 1;
    s.rate = s.agreed / s.decided;
    by.set(r.action, s);
  }
  return [...by.values()].sort((a, b) => b.decided - a.decided);
}
