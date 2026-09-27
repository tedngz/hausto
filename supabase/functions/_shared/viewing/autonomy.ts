// When the AI operator may act on its own (AI operator plan, stage 2).
//
// Stage 2 is "renter auto": the AI operator answers renters itself, and people
// keep every escalation and all of the broker work. It is not switched on by
// deciding it is ready. It is switched on by three locks, all of which have to
// be open, and it closes again by itself if the numbers fall:
//
//   1. AI_OPERATOR_AUTONOMY (an edge-function secret) lists the action. Unset
//      means off, which is the state it ships in.
//   2. No operator has paused it (`ai_operator_controls.paused`).
//   3. The gate: stage 1's record on that exact action clears the bar below,
//      measured from operators' own decisions - and, once it has been acting,
//      its flagged share stays under the ceiling.
//
// Only proposals that answer from facts qualify: a REPLY at HIGH confidence,
// which renter-reply.ts gives only to a draft that needs nothing from an
// agent. A holding reply ("we will check with the agent") still goes to a
// person, because it promises work only a person can start.
//
// Pure. The thresholds are here, in one place, tested.

import type { AgreementStats } from './proposals.ts';

/** Stamped on every event the AI operator writes itself, as AGENT:<version>. */
export const AUTO_AGENT_VERSION = 'auto-v1';

/**
 * Actions the AI operator may take alone, each behind its own gate measured on
 * its own record:
 *
 *   REPLY           stage 2 - answering a renter from facts
 *   OUTCOME         stage 3 - recording what an agent's reply said
 *   CONTACTED,      stage 4 - messages to agents: the first ask, a chase, and
 *   NUDGE,          the confirm or release once the renter has decided. Only
 *   NOTIFY_REALTOR  through the Zalo bridge (see REALTOR_SENDS).
 */
export const AUTONOMOUS_ACTIONS = ['REPLY', 'OUTCOME', 'CONTACTED', 'NUDGE', 'NOTIFY_REALTOR'] as const;

/**
 * Messages to agents. They may only run alone while REALTOR_CHANNEL is the
 * bridge: under the manual channel, recording "contacted" means a person
 * already sent it by hand - an AI operator recording it would be claiming a
 * message nobody sent.
 */
export const REALTOR_SENDS: ReadonlySet<string> = new Set(['CONTACTED', 'NUDGE', 'NOTIFY_REALTOR']);
export type AutonomousAction = typeof AUTONOMOUS_ACTIONS[number];

/**
 * The bar, per action, over the last 30 days of stage 1 decisions.
 *
 * Thirty decisions, because below that one bad afternoon is a quarter of the
 * sample. Ninety per cent agreement, because a renter reply that goes out
 * wrong costs a billed message and trust. And at most a fifth reworded on the
 * way out: an operator "agreeing" by rewriting every draft is not agreement
 * with the draft.
 */
export const GATE = {
  minDecided: 30,
  minAgreement: 0.9,
  maxEditedShare: 0.2,
  /** Once acting: flagged / (executed + flagged) above this closes the gate again. */
  maxFlaggedShare: 0.05,
  /** Flags are not judged on fewer than this many autonomous actions. */
  minExecutedForFlagRate: 10,
} as const;

/** How long an autonomous proposal waits for a person before it runs. */
export const AUTO_HOLD_MS = 5 * 60_000;

export interface GateCheck {
  open: boolean;
  /** Why, in one line, for the console. */
  reason: string;
}

export function gateFor(stats: AgreementStats | undefined, executed: number, flagged: number): GateCheck {
  if (!stats || stats.decided < GATE.minDecided) {
    return { open: false, reason: `${stats?.decided ?? 0} of ${GATE.minDecided} shadow decisions so far.` };
  }
  const rate = stats.rate ?? 0;
  if (rate < GATE.minAgreement) {
    return { open: false, reason: `Agreement ${Math.round(rate * 100)}%, below ${GATE.minAgreement * 100}%.` };
  }
  const editedShare = stats.edited / stats.decided;
  if (editedShare > GATE.maxEditedShare) {
    return { open: false, reason: `${Math.round(editedShare * 100)}% reworded before sending, above ${GATE.maxEditedShare * 100}%.` };
  }
  const ceiling = flagCeiling(executed, flagged);
  if (ceiling) return ceiling;
  return { open: true, reason: `Agreement ${Math.round(rate * 100)}% over ${stats.decided} decisions.` };
}

/** The one check that applies with or without an override: too many of its own actions flagged. */
function flagCeiling(executed: number, flagged: number): GateCheck | null {
  const acted = executed + flagged;
  if (acted >= GATE.minExecutedForFlagRate && flagged / acted > GATE.maxFlaggedShare) {
    return { open: false, reason: `${flagged} of ${acted} autonomous actions flagged as wrong - closed until reviewed.` };
  }
  return null;
}

/**
 * The gate, skipped on purpose (`ai_operator_controls.gate_override`). The
 * shadow record is not required - that is what an override is - but the flag
 * ceiling still is, so an override that goes wrong closes itself.
 */
export function overriddenGate(stats: AgreementStats | undefined, executed: number, flagged: number): GateCheck {
  return flagCeiling(executed, flagged) ?? {
    open: true,
    reason: `Gate skipped by override - ${stats?.decided ?? 0} shadow decisions so far, not the ${GATE.minDecided} it asks for.`,
  };
}

export interface AutonomyState {
  /** Per autonomous action: may it act right now, and why (not). */
  actions: Record<AutonomousAction, GateCheck & { enabled: boolean }>;
  paused: boolean;
}

/**
 * The three locks, combined. `env` is the AI_OPERATOR_AUTONOMY value: a
 * comma-separated list of actions, e.g. "REPLY".
 */
export function autonomyState(opts: {
  env: string | undefined;
  paused: boolean;
  stats: AgreementStats[];
  executed: Record<string, number>;
  flagged: Record<string, number>;
  /** Actions whose measured gate an owner chose to skip. */
  gateOverride?: string[];
  /** REALTOR_CHANNEL as the functions see it. Agent messages need 'bridge'. */
  realtorChannel?: string;
}): AutonomyState {
  const listed = new Set((opts.env ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  const overridden = new Set((opts.gateOverride ?? []).map(s => s.toUpperCase()));
  const actions = {} as AutonomyState['actions'];
  for (const action of AUTONOMOUS_ACTIONS) {
    const args = [opts.stats.find(s => s.action === action), opts.executed[action] ?? 0, opts.flagged[action] ?? 0] as const;
    const gate = overridden.has(action) ? overriddenGate(...args) : gateFor(...args);
    const enabled = listed.has(action);
    const noBridge = REALTOR_SENDS.has(action) && opts.realtorChannel !== 'bridge';
    actions[action] = {
      enabled,
      open: enabled && !opts.paused && !noBridge && gate.open,
      reason: !enabled ? `Off - AI_OPERATOR_AUTONOMY does not list ${action}.`
        : opts.paused ? 'Paused by an operator.'
        : noBridge ? 'Agent messages go by hand (REALTOR_CHANNEL is not bridge), so the AI operator cannot send them itself.'
        : gate.reason,
    };
  }
  return { actions, paused: opts.paused };
}

/**
 * Could this proposal ever run by itself? The class, before the locks.
 *
 * A REPLY at HIGH confidence: answered wholly from facts. An OUTCOME only when
 * it is an agent's reply read by paste-parse (key `OUTCOME:<item>:<reply>`)
 * at HIGH confidence with nothing flagged - never NO_RESPONSE, which closes an
 * item on silence and stays a person's call.
 */
export function autoEligible(p: { action: string; confidence: string; key?: string; dedupe_key?: string }):
  p is { action: AutonomousAction; confidence: 'HIGH'; key?: string; dedupe_key?: string } {
  if (!(AUTONOMOUS_ACTIONS as readonly string[]).includes(p.action) || p.confidence !== 'HIGH') return false;
  if (p.action === 'OUTCOME') return (p.key ?? p.dedupe_key ?? '').startsWith('OUTCOME:');
  return true;
}

/** May it run now? Eligible, its lock open, and its hold elapsed. */
export function mayExecute(
  state: AutonomyState,
  p: { action: string; confidence: string; execute_after: string | null; dedupe_key?: string },
  now: number,
): boolean {
  if (!autoEligible(p) || !p.execute_after) return false;
  return state.actions[p.action].open && Date.parse(p.execute_after) <= now;
}
