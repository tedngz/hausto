import { describe, it, expect } from 'vitest';
import { decideAction, costsASend, type AgentInput } from './agent.ts';

const input = (over: Partial<AgentInput> = {}): AgentInput => ({
  enabled: true, intent: 'UNKNOWN', text: 'hello', optedOut: false, confirmed: false, ...over,
});

describe('the switch', () => {
  it('does nothing at all when off, whatever the message says', () => {
    for (const intent of ['SELECTION', 'SEARCH', 'CONFIRM', 'QUESTION']) {
      const a = decideAction(input({ enabled: false, intent, selection: { listingIds: ['l1'] } }));
      expect(a.kind, intent).toBe('NONE');
      expect(a.kind === 'NONE' && a.reason).toBe('agent disabled');
    }
  });

  it('names why it did nothing, every time', () => {
    // "the agent did nothing", "the agent is off" and "the agent chose not to"
    // are three different facts and only one of them is a bug.
    const a = decideAction(input({ intent: 'QUESTION' }));
    expect(a.kind === 'NONE' && a.reason).toContain('QUESTION');
  });
});

describe('what it will act on', () => {
  it('re-requests what they picked', () => {
    const a = decideAction(input({ intent: 'SELECTION', selection: { listingIds: ['l1', 'l3'] } }));
    expect(a).toEqual({ kind: 'RE_REQUEST', listingIds: ['l1', 'l3'] });
  });

  it('explains a pick it cannot honour, rather than going quiet', () => {
    const a = decideAction(input({ intent: 'SELECTION', selection: { problem: 'EXPIRED' } }));
    expect(a).toEqual({ kind: 'SELECTION_PROBLEM', problem: 'EXPIRED' });
  });

  it('searches when they described what they want', () => {
    const a = decideAction(input({ intent: 'SEARCH', text: 'anything in district 2 under 15tr' }));
    expect(a).toEqual({ kind: 'SEARCH', query: 'anything in district 2 under 15tr' });
  });
});

describe('what it will not touch', () => {
  it('leaves every other intent to an operator', () => {
    for (const intent of ['CONFIRM', 'DECLINE', 'RESCHEDULE', 'QUESTION', 'UNKNOWN']) {
      const a = decideAction(input({ intent }));
      expect(a.kind, intent).toBe('NONE');
    }
  });

  it('never replies to an opt-out', () => {
    // Replying at all is the wrong answer to "stop messaging me", even to
    // acknowledge it.
    expect(decideAction(input({ intent: 'OPT_OUT' })).kind).toBe('NONE');
    // ...including when the same message also picked something.
    const a = decideAction(input({ intent: 'SELECTION', optedOut: true, selection: { listingIds: ['l1'] } }));
    expect(a.kind).toBe('NONE');
    expect(a.kind === 'NONE' && a.reason).toBe('opted out');
  });

  it('stays out of the way when the reply already closed the request', () => {
    // The confirmation path answers that one. Two replies to one message is
    // exactly what the one-reply rule forbids.
    const a = decideAction(input({ intent: 'CONFIRM', confirmed: true }));
    expect(a.kind).toBe('NONE');
    expect(a.kind === 'NONE' && a.reason).toContain('confirmation');
  });

  it('does nothing when a selection resolved to neither ids nor a problem', () => {
    expect(decideAction(input({ intent: 'SELECTION', selection: {} })).kind).toBe('NONE');
  });
});

describe('one reply per inbound', () => {
  it('returns a single action, never a list', () => {
    const a = decideAction(input({ intent: 'SELECTION', selection: { listingIds: ['l1'] } }));
    expect(Array.isArray(a)).toBe(false);
  });

  it('knows which actions spend money', () => {
    expect(costsASend({ kind: 'NONE', reason: 'x' })).toBe(false);
    expect(costsASend({ kind: 'RE_REQUEST', listingIds: ['l1'] })).toBe(true);
    expect(costsASend({ kind: 'SEARCH', query: 'x' })).toBe(true);
    expect(costsASend({ kind: 'SELECTION_PROBLEM', problem: 'EXPIRED' })).toBe(true);
  });
});

describe('complex watches (SPEC §11)', () => {
  const confirmed = {
    kind: 'CONFIRMED' as const, watchId: 'w1', complexName: 'Empire City',
    bedrooms: 2, budgetMaxVnd: 30_000_000, expiresAt: '2026-11-27T03:00:00Z',
  };

  it('answers a watch code even with the agent off - the site told them to send it', () => {
    const a = decideAction(input({ enabled: false, watch: confirmed }));
    expect(a.kind).toBe('WATCH_CONFIRMED');
    expect(a.kind === 'WATCH_CONFIRMED' && a.complexName).toBe('Empire City');
  });

  it('says what went wrong with a bad code', () => {
    const a = decideAction(input({ enabled: false, watch: { kind: 'PROBLEM', problem: 'EXPIRED' } }));
    expect(a).toEqual({ kind: 'WATCH_PROBLEM', problem: 'EXPIRED' });
  });

  it('sends the places when they answer an alert, with the agent off', () => {
    for (const intent of ['CONFIRM', 'QUESTION', 'UNKNOWN', 'SELECTION']) {
      const a = decideAction(input({ enabled: false, intent, alertMessageId: 'm9' }));
      expect(a, intent).toEqual({ kind: 'ALERT_DETAILS', alertMessageId: 'm9' });
    }
  });

  it('sends nothing to a no, and lets a real search be a search', () => {
    expect(decideAction(input({ intent: 'DECLINE', alertMessageId: 'm9' })).kind).toBe('NONE');
    expect(decideAction(input({ intent: 'SEARCH', text: 'anything in D2', alertMessageId: 'm9' })).kind).toBe('SEARCH');
  });

  it('never answers a STOP, whatever else is pending', () => {
    expect(decideAction(input({ intent: 'OPT_OUT', optedOut: true, watch: confirmed })).kind).toBe('NONE');
    expect(decideAction(input({ intent: 'OPT_OUT', optedOut: true, alertMessageId: 'm9' })).kind).toBe('NONE');
  });
});
