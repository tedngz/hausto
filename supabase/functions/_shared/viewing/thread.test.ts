import { describe, it, expect } from 'vitest';
import { waitingReplies, checkOperatorReply, MAX_REPLY_CHARS } from './thread.ts';
import type { DomainEvent } from '../viewing-domain.ts';

let seq = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, minute = seq): DomainEvent => {
  seq += 1;
  return {
    id: seq,
    request_id: 'r',
    item_id: null,
    type,
    payload,
    actor: 'SYSTEM',
    occurred_at: `2026-09-25T10:${String(minute).padStart(2, '0')}:00.000Z`,
  };
};
const replied = (intent: string, id: string, extra: Record<string, unknown> = {}) =>
  ev('RENTER_REPLIED', { intent, message_id: id, ...extra });

describe('which renter replies are waiting on a person', () => {
  it('holds every reply that is not a yes or a stop', () => {
    seq = 0;
    const events = [
      replied('QUESTION', 'm1'),
      replied('RESCHEDULE', 'm2'),
      replied('DECLINE', 'm3'),
      replied('UNKNOWN', 'm4'),
      replied('CONFIRM', 'm5'),
      replied('OPT_OUT', 'm6'),
    ];
    expect(waitingReplies(events).map(w => w.messageId)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('does not count the wa.me handshake as a reply to anything', () => {
    // Every request starts with one. Counting it would put every new request
    // at the top of the queue as a renter waiting on us.
    seq = 0;
    expect(waitingReplies([replied('UNKNOWN', 'm1', { handshake: true })])).toEqual([]);
  });

  it('is cleared by an operator reply, and by an acknowledgement', () => {
    seq = 0;
    expect(waitingReplies([replied('QUESTION', 'm1'), ev('REPLY_SENT', { message_id: 'o1' })])).toEqual([]);
    seq = 0;
    expect(waitingReplies([replied('UNKNOWN', 'm1'), ev('REPLIES_ACKNOWLEDGED')])).toEqual([]);
  });

  it('counts only what arrived after the last answer', () => {
    seq = 0;
    const events = [
      replied('QUESTION', 'm1'),
      ev('REPLY_SENT', { message_id: 'o1' }),
      replied('RESCHEDULE', 'm2'),
    ];
    expect(waitingReplies(events).map(w => w.messageId)).toEqual(['m2']);
  });

  it('lets agent suggestions answer a search but not a question', () => {
    // Three flats is an answer to "anything in D2 under 15tr?" and no answer
    // at all to "can we move it to Saturday?".
    seq = 0;
    const events = [
      replied('SEARCH', 'm1'),
      replied('QUESTION', 'm2'),
      ev('SUGGESTIONS_OFFERED', { listing_ids: ['a', 'b'] }),
    ];
    expect(waitingReplies(events).map(w => w.messageId)).toEqual(['m2']);
  });

  it('reads the log in time order whatever order it arrives in', () => {
    seq = 0;
    const events = [
      replied('QUESTION', 'm1', {}),
      ev('REPLY_SENT', { message_id: 'o1' }),
      replied('RESCHEDULE', 'm2'),
    ];
    const reversed = [...events].reverse();
    expect(waitingReplies(reversed)).toEqual(waitingReplies(events));
  });
});

describe('what an operator may say to a renter', () => {
  it('passes an ordinary answer through', () => {
    const r = checkOperatorReply('The second place allows a small dog. Want us to ask about Saturday?', 'CONTACTING');
    expect(r).toEqual({ ok: true, body: 'The second place allows a small dog. Want us to ask about Saturday?' });
  });

  it('refuses an empty reply and an overlong one', () => {
    expect(checkOperatorReply('   ', 'CONTACTING').ok).toBe(false);
    expect(checkOperatorReply('x'.repeat(MAX_REPLY_CHARS + 1), 'CONTACTING').ok).toBe(false);
  });

  it('refuses a phone number in any typed shape', () => {
    // The broker's number is on the same screen. The renter comes back to us.
    for (const n of ['0901234567', '+84 90 123 45 67', '84.90.123.4567', '090-123-4567']) {
      expect(checkOperatorReply(`Call the agent on ${n}`, 'DELIVERED').ok).toBe(false);
    }
  });

  it('does not mistake a price or a listing link for a phone number', () => {
    expect(checkOperatorReply('The agent now asks 15.000.000 ₫ a month.', 'DELIVERED').ok).toBe(true);
    expect(checkOperatorReply('It is 15000000 now', 'DELIVERED').ok).toBe(true);
    expect(checkOperatorReply('Here it is: https://www.nhatot.com/thue-can-ho/0901234567.htm', 'DELIVERED').ok).toBe(true);
  });

  it('keeps booking vocabulary out until the renter has confirmed', () => {
    expect(checkOperatorReply('You are booked for 10am', 'DELIVERED').ok).toBe(false);
    expect(checkOperatorReply('Your booking is noted', 'CONTACTING').ok).toBe(false);
    expect(checkOperatorReply('Your booking is confirmed - see you Saturday', 'CONFIRMED').ok).toBe(true);
    // A word that merely contains it is not the word.
    expect(checkOperatorReply('The flat has a big bookshelf', 'DELIVERED').ok).toBe(true);
  });

  it('turns an em dash into a hyphen rather than refusing', () => {
    expect(checkOperatorReply('Saturday works — 10am', 'DELIVERED')).toEqual({ ok: true, body: 'Saturday works - 10am' });
  });
});
