import { describe, it, expect } from 'vitest';
import {
  DEADLINE_STAGES, INQUIRY_DEADLINE_JOB, deadlineAlertNeeded, deadlineJobs, renderDeadlineAlert, renderAgentReplyAlert,
} from './inquiry-deadline.ts';
import { INQUIRY_REPLY_WITHIN_MS, reduceInquiry, type InquiryEvent, type InquiryView } from '../viewing-domain.ts';

const H = 3_600_000;
let n = 0;
const ev = (type: string, at: number, payload: Record<string, unknown> = {}): InquiryEvent =>
  ({ id: ++n, inquiry_id: 'inq-1', type, payload, actor: 'OPS:op-1', occurred_at: new Date(at).toISOString() });

const T0 = Date.parse('2026-09-30T02:00:00Z');
const confirmed = (): InquiryView => reduceInquiry('inq-1', [ev('CONFIRMED', T0)]);
const iso = (ms: number) => new Date(ms).toISOString();

describe('deadline jobs', () => {
  it('schedules two reminders, at 16 and 22 hours after the code', () => {
    const jobs = deadlineJobs('inq-1', iso(T0));
    expect(jobs.map(j => j.kind)).toEqual([INQUIRY_DEADLINE_JOB, INQUIRY_DEADLINE_JOB]);
    expect(jobs.map(j => j.run_after)).toEqual([iso(T0 + 16 * H), iso(T0 + 22 * H)]);
    expect(jobs.map(j => j.payload)).toEqual([
      { inquiry_id: 'inq-1', stage: '16H' }, { inquiry_id: 'inq-1', stage: '22H' },
    ]);
  });
});

describe('whether a reminder is still needed', () => {
  it('is needed when nobody has answered', () => {
    expect(deadlineAlertNeeded(confirmed(), null)).toBe(true);
  });

  it('is not needed once a person answered after the code', () => {
    expect(deadlineAlertNeeded(confirmed(), iso(T0 + 3 * H))).toBe(false);
  });

  it('ignores an answer from before the code - it was not to this request', () => {
    expect(deadlineAlertNeeded(confirmed(), iso(T0 - H))).toBe(true);
  });

  it('is not needed once units were offered, or the request closed', () => {
    const offered = reduceInquiry('inq-1', [ev('CONFIRMED', T0), ev('UNITS_OFFERED', T0 + H, { listing_ids: ['a'] })]);
    const closed = reduceInquiry('inq-1', [ev('CONFIRMED', T0), ev('CLOSED', T0 + H, { reason: 'DUPLICATE' })]);
    expect(deadlineAlertNeeded(offered, null)).toBe(false);
    expect(deadlineAlertNeeded(closed, null)).toBe(false);
  });

  it('is never needed for a request whose code never came', () => {
    expect(deadlineAlertNeeded(reduceInquiry('inq-1', [ev('SUBMITTED', T0)]), null)).toBe(false);
  });
});

describe('no request passes 24 hours unanswered without a reminder (property)', () => {
  // A deterministic sweep standing in for random draws: every confirmation
  // time across a day, and every answer time from never to 30 hours later.
  it('holds for every confirmation and answer time', () => {
    for (let c = 0; c < 24 * 60; c += 37) {
      const t0 = T0 + c * 60_000;
      const view = reduceInquiry('inq-1', [ev('CONFIRMED', t0)]);
      const jobs = deadlineJobs('inq-1', iso(t0));
      for (const answerAfterH of [null, 0.5, 5, 15.9, 16.1, 21.9, 22.1, 30]) {
        const answeredAt = answerAfterH === null ? null : t0 + answerAfterH * H;
        // Every reminder that fires before the answer, fires before the deadline.
        const fired = jobs.filter(j => {
          const at = Date.parse(j.run_after);
          const answeredBy = answeredAt !== null && answeredAt <= at ? iso(answeredAt) : null;
          return deadlineAlertNeeded(view, answeredBy);
        });
        const answeredInTime = answeredAt !== null && answeredAt < t0 + INQUIRY_REPLY_WITHIN_MS;
        const warnedInTime = fired.some(j => Date.parse(j.run_after) < t0 + INQUIRY_REPLY_WITHIN_MS);
        expect(answeredInTime || warnedInTime, `confirmed +${c}min, answered +${answerAfterH}h`).toBe(true);
      }
    }
  });

  it('keeps every stage inside the 24 hours', () => {
    for (const s of DEADLINE_STAGES) {
      expect(s.beforeMs).toBeGreaterThan(0);
      expect(s.beforeMs).toBeLessThan(INQUIRY_REPLY_WITHIN_MS);
    }
    // At 16h and 22h after the code, as before Priority search.
    expect(deadlineJobs('i', iso(T0)).map(j => Date.parse(j.run_after) - T0)).toEqual([16 * H, 22 * H]);
  });

  it('moves the stages out with an area search, promised in 48 hours', () => {
    expect(deadlineJobs('i', iso(T0), 48 * H).map(j => Date.parse(j.run_after) - T0)).toEqual([40 * H, 46 * H]);
  });
});

describe('the reminder email', () => {
  const alert = renderDeadlineAlert({
    complexName: 'Empire City', summary: '2 bedrooms, up to 25.000.000 ₫ a month',
    confirmedAt: iso(T0), now: new Date(T0 + 22 * H), agentsAsked: 1,
  });

  it('says where, how long is left, and what was done', () => {
    expect(alert.subject).toBe('Empire City - availability reply due in 2h');
    expect(alert.text).toContain('1 agent has been asked');
    expect(alert.text).toContain('https://hausto-ops.vercel.app');
    expect(alert.text).not.toMatch(/[—–]/);
  });

  it('carries nothing about the renter', () => {
    // renderDeadlineAlert takes no renter field at all; this pins the output.
    expect(alert.text).not.toMatch(/\+\d{6,}|Mai|@/);
  });
});

describe('an agent answering an availability check (S7.2)', () => {
  it('says who, where and what they said - nothing about the renter', () => {
    const a = renderAgentReplyAlert({ complexName: 'Empire City', agentName: 'Linh', text: 'Còn 1 căn 2PN\ntầng 18, 24tr' });
    expect(a.subject).toBe('Empire City - Linh replied about availability');
    expect(a.text).toContain('> Còn 1 căn 2PN\n> tầng 18, 24tr');
    expect(a.text).toContain('https://hausto-ops.vercel.app');
    expect(renderAgentReplyAlert({ complexName: 'X', agentName: null, text: 'y'.repeat(700) }).text).toContain('y'.repeat(600) + '...');
  });
});
