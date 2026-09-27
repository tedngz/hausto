import { describe, it, expect } from 'vitest';
import { gateFor, autonomyState, autoEligible, mayExecute, GATE, AUTO_HOLD_MS } from './autonomy.ts';
import type { AgreementStats } from './proposals.ts';

const stats = (decided: number, agreed: number, edited = 0): AgreementStats => ({
  action: 'REPLY', decided, agreed, corrected: decided - agreed, rejected: 0, edited, rate: decided ? agreed / decided : null,
});

describe('the gate', () => {
  it('stays shut until there are enough decisions to mean anything', () => {
    expect(gateFor(undefined, 0, 0).open).toBe(false);
    expect(gateFor(stats(GATE.minDecided - 1, GATE.minDecided - 1), 0, 0)).toMatchObject({ open: false, reason: '29 of 30 shadow decisions so far.' });
    expect(gateFor(stats(GATE.minDecided, GATE.minDecided), 0, 0).open).toBe(true);
  });

  it('stays shut below the agreement bar', () => {
    expect(gateFor(stats(40, 35), 0, 0)).toMatchObject({ open: false, reason: 'Agreement 88%, below 90%.' });
    expect(gateFor(stats(40, 36), 0, 0).open).toBe(true);
  });

  it('does not count agreement-by-rewriting as agreement with the draft', () => {
    expect(gateFor(stats(40, 40, 9), 0, 0).open).toBe(false);
    expect(gateFor(stats(40, 40, 8), 0, 0).open).toBe(true);
  });

  it('closes again once too many of its own actions are flagged - but not on a handful', () => {
    const good = stats(40, 40);
    expect(gateFor(good, 9, 1).open).toBe(false);   // 1 of 10: 10%
    expect(gateFor(good, 40, 1).open).toBe(true);   // 1 of 41: under 5%
    expect(gateFor(good, 3, 1).open).toBe(true);    // 4 actions is too few to judge
  });
});

describe('the three locks', () => {
  const open = [stats(40, 40)];

  it('ships shut: no env, nothing acts, whatever the record', () => {
    const s = autonomyState({ env: undefined, paused: false, stats: open, executed: {}, flagged: {} });
    expect(s.actions.REPLY).toMatchObject({ enabled: false, open: false });
    expect(s.actions.REPLY.reason).toMatch(/AI_OPERATOR_AUTONOMY/);
  });

  it('needs the env to name the action, and reads it forgivingly', () => {
    expect(autonomyState({ env: ' reply , ', paused: false, stats: open, executed: {}, flagged: {} }).actions.REPLY.open).toBe(true);
    expect(autonomyState({ env: 'NUDGE', paused: false, stats: open, executed: {}, flagged: {} }).actions.REPLY.open).toBe(false);
  });

  it('is shut by an operator\'s pause even with everything else open', () => {
    const s = autonomyState({ env: 'REPLY', paused: true, stats: open, executed: {}, flagged: {} });
    expect(s.actions.REPLY).toMatchObject({ enabled: true, open: false, reason: 'Paused by an operator.' });
  });

  it('is shut by the gate even with the env on and nobody pausing', () => {
    const s = autonomyState({ env: 'REPLY', paused: false, stats: [stats(10, 10)], executed: {}, flagged: {} });
    expect(s.actions.REPLY.open).toBe(false);
  });
});

describe('what may run by itself', () => {
  const state = autonomyState({ env: 'REPLY', paused: false, stats: [stats(40, 40)], executed: {}, flagged: {} });
  const now = Date.parse('2026-09-27T03:00:00Z');

  it('is only a confident reply - never a holding one, never broker work', () => {
    expect(autoEligible({ action: 'REPLY', confidence: 'HIGH' })).toBe(true);
    expect(autoEligible({ action: 'REPLY', confidence: 'LOW' })).toBe(false);
    for (const action of ['CONTACTED', 'NUDGE', 'OUTCOME', 'NOTIFY_REALTOR', 'DELIVER', 'CANCEL_REQUEST', 'ESCALATE']) {
      expect(autoEligible({ action, confidence: 'HIGH' })).toBe(false);
    }
  });

  it('waits out its hold, and never runs without one', () => {
    const due = new Date(now - 1).toISOString();
    const later = new Date(now + AUTO_HOLD_MS).toISOString();
    expect(mayExecute(state, { action: 'REPLY', confidence: 'HIGH', execute_after: due }, now)).toBe(true);
    expect(mayExecute(state, { action: 'REPLY', confidence: 'HIGH', execute_after: later }, now)).toBe(false);
    expect(mayExecute(state, { action: 'REPLY', confidence: 'HIGH', execute_after: null }, now)).toBe(false);
  });

  it('checks the locks again at run time, not only when the hold was set', () => {
    const paused = autonomyState({ env: 'REPLY', paused: true, stats: [stats(40, 40)], executed: {}, flagged: {} });
    expect(mayExecute(paused, { action: 'REPLY', confidence: 'HIGH', execute_after: new Date(now - 1).toISOString() }, now)).toBe(false);
  });
});
