// The lock-in deadline, run (the pricing rework, SPEC §9).
//
// A plan that is not locked in by its deadline is cancelled by rule, and every
// agent holding a slot for it is then owed a release - the drain turns that
// into RELEASE_REALTOR jobs, as for any cancelled request (reminders.ts
// `realtorDecisionsOwed`). Agents confirm times before anyone pays; this is
// what stops a plan nobody locks in from holding their slots for ever.
//
// Until the rework a person decided to cancel an unanswered plan. This is the
// one cancellation that is not a person's: it is the rule the renter was shown
// in the plan itself, run by the job runner as SYSTEM. It goes through the
// console's own CANCEL_REQUEST (`performOpsAction`), so there is one way to
// cancel a request, not two. The AI operator still may not cancel (SPEC §10).

import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { loadLockIn } from './lock-in-run.ts';
import type { LockInStatus } from './lock-in.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export const LOCK_IN_DEADLINE_JOB = 'LOCK_IN_DEADLINE';

/**
 * Cancel the plan if, read again now, it has lapsed. Anything else - locked
 * in meanwhile, a checkout still open, already closed - is reported and left
 * alone.
 */
export async function runLockInDeadline(
  db: Supa,
  deps: OpsDeps,
  requestId: string,
  now: number,
): Promise<'CANCELLED' | LockInStatus | 'UNKNOWN_REQUEST' | `error: ${string}`> {
  const ctx = await loadLockIn(db, { requestId }, now);
  if (!ctx) return 'UNKNOWN_REQUEST';
  if (ctx.status !== 'LAPSED') return ctx.status;
  const result = await performOpsAction(db, deps, 'SYSTEM', {
    action: 'CANCEL_REQUEST',
    requestId,
    reason: 'NOT_LOCKED_IN',
    note: `Not locked in by the deadline, ${ctx.deadline}.`,
  });
  return result.status === 200 ? 'CANCELLED' : `error: ${String(result.body.error ?? result.status)}`;
}
