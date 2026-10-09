// The 24-hour promise on an availability request, kept (PLAN-v3 S7.1c).
//
// The confirmation tells the renter a person replies within 24 hours of their
// code, and after 24 hours the WhatsApp window has shut, so a late reply cannot
// even be sent. Two reminders make that hard to miss: at 16 hours and at 22,
// the ops team is emailed if nobody has answered yet. They are `jobs` rows,
// enqueued when the code arrives and run by viewing-jobs-run; each decides at
// run time whether it is still needed, so answering in the console is all it
// takes to silence them.
//
// Pure. Nothing about the renter goes in the email - the console is where the
// request is worked, and it cannot show them either (invariant 4).

import { INQUIRY_REPLY_WITHIN_MS, type InquiryView } from '../viewing-domain.ts';

export const INQUIRY_DEADLINE_JOB = 'INQUIRY_DEADLINE';

/**
 * When the reminders fire: 8 and 2 hours before the promise - 16h and 22h
 * for a building's 24, 40h and 46h for an area's 48 (Priority search).
 */
export const DEADLINE_STAGES = [
  { stage: '16H', beforeMs: 8 * 3_600_000 },
  { stage: '22H', beforeMs: 2 * 3_600_000 },
] as const;
export type DeadlineStage = typeof DEADLINE_STAGES[number]['stage'];

/** The `jobs` rows to enqueue when a request's code arrives. */
export function deadlineJobs(inquiryId: string, confirmedAt: string, replyWithinMs = INQUIRY_REPLY_WITHIN_MS): {
  kind: string; run_after: string; payload: { inquiry_id: string; stage: DeadlineStage };
}[] {
  const due = Date.parse(confirmedAt) + replyWithinMs;
  return DEADLINE_STAGES.map(s => ({
    kind: INQUIRY_DEADLINE_JOB,
    run_after: new Date(due - s.beforeMs).toISOString(),
    payload: { inquiry_id: inquiryId, stage: s.stage },
  }));
}

/**
 * Does the request still need a reminder? No once a person has answered it on
 * WhatsApp (any message of ours after the code, other than the automatic
 * confirmation), once units have been offered, or once it is closed.
 */
export function deadlineAlertNeeded(view: InquiryView, answeredAt: string | null): boolean {
  if (!view.confirmedAt) return false;
  if (view.state === 'CLOSED' || view.state === 'OFFERED') return false;
  return !(answeredAt && answeredAt >= view.confirmedAt);
}

export function renderDeadlineAlert(opts: {
  complexName: string;
  summary: string;
  confirmedAt: string;
  now: Date;
  agentsAsked: number;
  replyWithinMs?: number;
}): { subject: string; text: string } {
  const due = Date.parse(opts.confirmedAt) + (opts.replyWithinMs ?? INQUIRY_REPLY_WITHIN_MS);
  const hoursLeft = Math.max(0, Math.round((due - opts.now.getTime()) / 3_600_000));
  const dueLocal = new Date(due + 7 * 3_600_000).toISOString();
  return {
    subject: `${opts.complexName} - availability reply due in ${hoursLeft}h`,
    text: [
      `A renter asked us to check availability at ${opts.complexName} (${opts.summary}).`,
      `Nobody has replied yet. The reply is promised by ${dueLocal.slice(11, 16)} on ${dueLocal.slice(0, 10)} (HCMC),`,
      (opts.replyWithinMs ?? INQUIRY_REPLY_WITHIN_MS) > INQUIRY_REPLY_WITHIN_MS
        ? `Their WhatsApp window closes 24 hours after their last message - past that only the request_update template reaches them.`
        : `when their WhatsApp window also closes - after that nothing can reach them until they write again.`,
      '',
      opts.agentsAsked > 0
        ? `${opts.agentsAsked} agent${opts.agentsAsked === 1 ? ' has' : 's have'} been asked so far.`
        : 'No agent has been asked yet.',
      'If nothing is found, one honest message still beats silence - end it with a question so their reply reopens the window.',
      '',
      'Work it in the ops console, under Availability: https://hausto-ops.vercel.app',
    ].join('\n'),
  };
}

/**
 * An agent answered an availability check through the Zalo bridge (S7.2).
 * The moment someone has to act - capture the unit, or ask the next agent -
 * so the ops team hears at once, not at the next deadline. Carries the
 * agent's own words and nothing about the renter.
 */
export function renderAgentReplyAlert(opts: {
  complexName: string;
  agentName: string | null;
  text: string;
}): { subject: string; text: string } {
  const who = opts.agentName?.trim() || 'An agent';
  const words = opts.text.length > 600 ? `${opts.text.slice(0, 600)}...` : opts.text;
  return {
    subject: `${opts.complexName} - ${who} replied about availability`,
    text: [
      `${who} answered our availability check for ${opts.complexName}:`,
      '',
      words.split('\n').map(l => `> ${l}`).join('\n'),
      '',
      'Record what they said, and capture any unit they offered, in the ops console under Availability: https://hausto-ops.vercel.app',
    ].join('\n'),
  };
}
