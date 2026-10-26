import { describe, it, expect } from 'vitest';
import { settlementFor, approvalOf, agreementStats, type ProposalRow } from './proposals.ts';

const proposal = (p: Partial<ProposalRow>): ProposalRow => ({
  id: 'p1', request_id: 'r', item_id: 'i1', dedupe_key: 'CONTACT:i1', action: 'CONTACTED', input: {}, status: 'PENDING', ...p,
});

describe('an operator doing the work by hand', () => {
  it('agrees with a proposal when they do the same thing to the same item', () => {
    expect(settlementFor(proposal({}), { action: 'CONTACTED', itemId: 'i1', input: {} })).toBe('AGREED');
  });

  it('corrects it when they do something else to that item', () => {
    expect(settlementFor(proposal({ action: 'NUDGE', dedupe_key: 'NUDGE:i1:1' }),
      { action: 'OUTCOME', itemId: 'i1', input: { outcome: 'ALREADY_RENTED' } })).toBe('CORRECTED');
  });

  it('compares the outcome, not just the action', () => {
    const p = proposal({ action: 'OUTCOME', dedupe_key: 'OUTCOME:i1:rm1', input: { outcome: 'CONFIRMED' } });
    expect(settlementFor(p, { action: 'OUTCOME', itemId: 'i1', input: { outcome: 'CONFIRMED' } })).toBe('AGREED');
    expect(settlementFor(p, { action: 'OUTCOME', itemId: 'i1', input: { outcome: 'ALTERNATIVE_OFFERED' } })).toBe('CORRECTED');
  });

  it('says nothing about another item, or about a preparatory step', () => {
    expect(settlementFor(proposal({}), { action: 'CONTACTED', itemId: 'i2', input: {} })).toBeNull();
    expect(settlementFor(proposal({}), { action: 'RECORD_CONTACT', itemId: 'i1', input: {} })).toBeNull();
    expect(settlementFor(proposal({}), { action: 'REALTOR_REPLY', itemId: 'i1', input: {} })).toBeNull();
  });

  it('agrees with an escalation whenever a person acts on it - that is what it asked for', () => {
    const p = proposal({ action: 'ESCALATE', dedupe_key: 'NO_CONTACT:i1' });
    expect(settlementFor(p, { action: 'RECORD_CONTACT', itemId: 'i1', input: {} })).toBe('AGREED');
  });

  it('settles renter proposals only on renter-facing actions', () => {
    const cancel = proposal({ item_id: null, dedupe_key: 'RENTER:m7', action: 'CANCEL_REQUEST' });
    expect(settlementFor(cancel, { action: 'CANCEL_REQUEST', itemId: null, input: {} })).toBe('AGREED');
    expect(settlementFor(cancel, { action: 'REPLY', itemId: null, input: {} })).toBe('CORRECTED');
    expect(settlementFor(cancel, { action: 'DELIVER', itemId: null, input: {} })).toBeNull();
  });

  it('never re-settles a decided proposal', () => {
    expect(settlementFor(proposal({ status: 'REJECTED' }), { action: 'CONTACTED', itemId: 'i1', input: {} })).toBeNull();
  });
});

describe('approving with edits', () => {
  const proposed = { itemId: 'i1', outcome: 'CONFIRMED', message: 'Chào anh', slots: [{ startsAt: 'a', durationMinutes: 30 }] };

  it('is still approval when only the wording changed, and records the edit', () => {
    expect(approvalOf(proposed, { message: 'Chào chị' })).toMatchObject({ status: 'APPROVED', edited: true });
    expect(approvalOf(proposed, {})).toMatchObject({ status: 'APPROVED', edited: false });
  });

  it('is a correction when what the action decides changed, whichever button was pressed', () => {
    expect(approvalOf(proposed, { outcome: 'ALTERNATIVE_OFFERED' }).status).toBe('CORRECTED');
    expect(approvalOf(proposed, { slots: [{ startsAt: 'b', durationMinutes: 30 }] }).status).toBe('CORRECTED');
  });

  it('runs the merged input', () => {
    expect(approvalOf(proposed, { message: 'Chào chị' }).input).toEqual({ ...proposed, message: 'Chào chị' });
  });
});

describe('the agreement rate', () => {
  it('counts approved and agreed as agreement, and leaves pending and superseded out', () => {
    const [s] = agreementStats([
      { action: 'CONTACTED', status: 'APPROVED', edited: true },
      { action: 'CONTACTED', status: 'AGREED', edited: false },
      { action: 'CONTACTED', status: 'CORRECTED', edited: false },
      { action: 'CONTACTED', status: 'REJECTED', edited: false },
      { action: 'CONTACTED', status: 'PENDING', edited: false },
      { action: 'CONTACTED', status: 'SUPERSEDED', edited: false },
    ]);
    expect(s).toEqual({ action: 'CONTACTED', decided: 4, agreed: 2, corrected: 1, rejected: 1, edited: 1, rate: 0.5 });
  });

  it('reports no rate rather than zero for an action nobody has decided', () => {
    expect(agreementStats([{ action: 'NUDGE', status: 'PENDING', edited: false }])).toEqual([]);
  });
});

describe('the terms an agent stated (LEASE_TERMS)', () => {
  const terms = { depositMonthsMin: 2, petsAllowed: false, fees: [] };
  const p = proposal({ action: 'LEASE_TERMS', dedupe_key: 'TERMS:i1:rm1', input: { itemId: 'i1', terms } });

  it('agrees when the operator records the same terms, however written, and corrects other ones', () => {
    expect(settlementFor(p, { action: 'LEASE_TERMS', itemId: 'i1', input: { terms: { ...terms, depositMonthsMax: '2' } } })).toBe('AGREED');
    expect(settlementFor(p, { action: 'LEASE_TERMS', itemId: 'i1', input: { terms: { ...terms, petsAllowed: true } } })).toBe('CORRECTED');
  });

  it('is not answered by an outcome, and does not answer one', () => {
    expect(settlementFor(p, { action: 'OUTCOME', itemId: 'i1', input: { outcome: 'CONFIRMED' } })).toBeNull();
    const outcome = proposal({ action: 'OUTCOME', dedupe_key: 'OUTCOME:i1:rm1', input: { outcome: 'CONFIRMED' } });
    expect(settlementFor(outcome, { action: 'LEASE_TERMS', itemId: 'i1', input: { terms } })).toBeNull();
    const escalation = proposal({ action: 'ESCALATE', dedupe_key: 'OUTCOME:i1:rm1' });
    expect(settlementFor(escalation, { action: 'LEASE_TERMS', itemId: 'i1', input: { terms } })).toBeNull();
  });

  it('calls changing the terms on approval a correction', () => {
    expect(approvalOf(p.input, { terms: { ...terms, petsAllowed: true } }).status).toBe('CORRECTED');
    expect(approvalOf(p.input, { note: 'agent was sure' })).toMatchObject({ status: 'APPROVED', edited: true });
  });
});
