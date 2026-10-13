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

  it('sends nothing to a no', () => {
    expect(decideAction(input({ intent: 'DECLINE', alertMessageId: 'm9' })).kind).toBe('NONE');
  });

  it('sends the places to "show me", which the classifier reads as a search', () => {
    // The regression: with the agent off, "show me" got silence.
    for (const enabled of [true, false]) {
      expect(decideAction(input({ enabled, intent: 'SEARCH', text: 'show me', alertMessageId: 'm9' })))
        .toEqual({ kind: 'ALERT_DETAILS', alertMessageId: 'm9' });
    }
  });

  it('never answers a STOP, whatever else is pending', () => {
    expect(decideAction(input({ intent: 'OPT_OUT', optedOut: true, watch: confirmed })).kind).toBe('NONE');
    expect(decideAction(input({ intent: 'OPT_OUT', optedOut: true, alertMessageId: 'm9' })).kind).toBe('NONE');
  });
});

describe('availability requests (SPEC §11)', () => {
  it('leaves a reply on a request to the concierge, agent on or off', () => {
    for (const enabled of [true, false]) {
      for (const intent of ['CONFIRM', 'SEARCH', 'SELECTION', 'QUESTION']) {
        const a = decideAction(input({ enabled, intent, inquiryId: 'inq-1', selection: { listingIds: ['l1'] } }));
        expect(a.kind, `${enabled} ${intent}`).toBe('NONE');
      }
    }
  });

  it('carries the request into the confirmation, so the words can change', () => {
    const inquiry = {
      id: 'inq-1', firstConfirm: true, fullName: 'Mai', complexName: 'Empire City', bedrooms: 2,
      budgetMaxVnd: 25_000_000, moveInDate: '2026-11-15', leaseMonths: 12, hasPets: false,
    };
    const a = decideAction(input({
      enabled: false,
      watch: {
        kind: 'CONFIRMED', watchId: 'w1', complexName: 'Empire City', bedrooms: 2,
        budgetMaxVnd: 25_000_000, expiresAt: '2026-11-29T16:59:59Z', inquiry,
      },
    }));
    expect(a.kind === 'WATCH_CONFIRMED' && a.inquiry?.id).toBe('inq-1');
  });
});

describe('a yes without the Pass (SPEC §9)', () => {
  const lockIn = { ref: 'HV-4KX2', deadline: '2026-09-17T03:00:00.000Z', freeViewingAvailable: true };

  it('says where to lock in, even with the agent off - the plan asked the question', () => {
    expect(decideAction(input({ enabled: false, intent: 'CONFIRM', lockIn }))).toEqual({ kind: 'LOCK_IN_LINK', lockIn });
  });

  it('says nothing to someone who opted out in the same breath', () => {
    expect(decideAction(input({ intent: 'OPT_OUT', lockIn })).kind).toBe('NONE');
    expect(decideAction(input({ optedOut: true, lockIn })).kind).toBe('NONE');
  });
});

describe('search from a cold DM (2026-10-13)', () => {
  it('greets a new number that did not open with a search, once the switch is on', () => {
    expect(decideAction(input({ firstContact: true, text: 'hi' }))).toEqual({ kind: 'WELCOME' });
    expect(decideAction(input({ enabled: false, firstContact: true, text: 'hi' })).kind).toBe('NONE');
  });

  it('searches a new number that opened with a search, rather than greeting it', () => {
    expect(decideAction(input({ firstContact: true, intent: 'SEARCH', text: '2br in d2 under 20tr' })).kind)
      .toBe('SEARCH');
  });

  it('does not greet a no, or a number that opted out', () => {
    expect(decideAction(input({ firstContact: true, intent: 'DECLINE', text: 'no' })).kind).toBe('NONE');
    expect(decideAction(input({ firstContact: true, intent: 'OPT_OUT', text: 'stop' })).kind).toBe('NONE');
  });

  it('reads "what about district 7" right after results as a new search', () => {
    expect(decideAction(input({ searching: true, intent: 'QUESTION', text: 'what about district 7?' })))
      .toEqual({ kind: 'SEARCH', query: 'what about district 7?' });
  });

  it('leaves the same words to an operator outside a search', () => {
    expect(decideAction(input({ intent: 'QUESTION', text: 'what about district 7?' })).kind).toBe('NONE');
  });

  it('leaves a question about a place to an operator, even mid-search', () => {
    expect(decideAction(input({ searching: true, intent: 'QUESTION', text: 'is there parking?' })).kind).toBe('NONE');
  });

  it('answers a number picked from search results with the pages', () => {
    expect(decideAction(input({ intent: 'SELECTION', text: '2', searchPick: { listingIds: ['l2'] } })))
      .toEqual({ kind: 'SEARCH_PICK', listingIds: ['l2'] });
  });

  it('says why when a pick from search results cannot be honoured', () => {
    expect(decideAction(input({ intent: 'SELECTION', text: '4', searchPick: { problem: 'OUT_OF_RANGE' } })))
      .toEqual({ kind: 'SELECTION_PROBLEM', problem: 'OUT_OF_RANGE' });
  });
});
