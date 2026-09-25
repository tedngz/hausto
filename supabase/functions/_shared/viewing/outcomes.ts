// The seven ops actions, and what each one requires (SPEC §4).
//
// Operators never free-text an outcome. Each action writes one typed
// `OUTCOME_RECORDED` event; free text goes in `note`, which is never parsed and
// never affects state. That constraint is the whole point of the milestone -
// it is how the corpus that automates the realtor side later gets generated,
// and a text box that changes state destroys it.
//
// Pure, so the requirements are testable without a database and so the console
// can grey out a button for the same reason the server would refuse it. The
// server is the one that decides; this module is just the only copy of the
// rules.

import { OUTCOMES, type Outcome } from '../viewing-domain.ts';

export { OUTCOMES };
export type { Outcome };

/** A viewing slot: a UTC instant with an explicit duration. */
export interface Slot {
  startsAt: string;
  durationMinutes: number;
}

export interface OutcomeSubmission {
  outcome: string;
  slots?: unknown;
  actualPriceVnd?: unknown;
  note?: unknown;
}

export interface ValidatedOutcome {
  outcome: Outcome;
  slots: Slot[];
  actualPriceVnd?: number;
  note?: string;
}

export type ValidationResult =
  | { ok: true; value: ValidatedOutcome }
  | { ok: false; error: string };

/** Outcomes that cannot be recorded without at least one slot. */
const NEEDS_SLOT: ReadonlySet<Outcome> = new Set<Outcome>(['CONFIRMED', 'ALTERNATIVE_OFFERED']);

/** How many nudges must already be logged before "no response" is a fact. */
export const NUDGES_BEFORE_NO_RESPONSE = 2;

/** A slot longer than this is a typo - minutes entered where hours were meant. */
const MAX_SLOT_MINUTES = 8 * 60;

function validateSlots(raw: unknown): { ok: true; value: Slot[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'slots must be a list.' };
  if (raw.length > 6) return { ok: false, error: 'At most 6 slots.' };

  const out: Slot[] = [];
  for (const s of raw) {
    const startsAt = String((s as Slot)?.startsAt ?? '');
    const duration = Number((s as Slot)?.durationMinutes);
    const t = Date.parse(startsAt);
    if (!Number.isFinite(t)) return { ok: false, error: `Not a time: ${startsAt || '(missing)'}` };
    // Stored UTC, always (SPEC §7). A bare local string would be read back as
    // whatever the reader's zone is, which for a viewing time is a missed
    // appointment rather than a rounding error.
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(startsAt)) {
      return { ok: false, error: `Slot time needs an explicit offset or Z: ${startsAt}` };
    }
    if (!Number.isInteger(duration) || duration <= 0 || duration > MAX_SLOT_MINUTES) {
      return { ok: false, error: `Slot duration must be 1-${MAX_SLOT_MINUTES} minutes, got ${duration}` };
    }
    out.push({ startsAt: new Date(t).toISOString(), durationMinutes: duration });
  }
  return { ok: true, value: out };
}

/**
 * Check one submission against SPEC §4.
 *
 * `priorNudges` is passed in rather than read, because this is pure and because
 * the count is a fact about the log the caller already has.
 */
export function validateOutcome(
  submission: OutcomeSubmission,
  context: { priorNudges: number },
): ValidationResult {
  const outcome = String(submission.outcome ?? '') as Outcome;
  if (!OUTCOMES.includes(outcome)) {
    return { ok: false, error: `Not one of the seven outcomes: ${submission.outcome || '(missing)'}` };
  }

  const slots = validateSlots(submission.slots);
  if (!slots.ok) return { ok: false, error: slots.error };

  if (NEEDS_SLOT.has(outcome) && slots.value.length === 0) {
    return { ok: false, error: `${outcome} needs at least one slot - that is what makes it the outcome it is.` };
  }

  // Slots on an outcome that has no use for them are not a harmless extra: they
  // would sit in the corpus as a confirmed time for a unit that is already let.
  if (!NEEDS_SLOT.has(outcome) && slots.value.length > 0) {
    return { ok: false, error: `${outcome} does not take slots.` };
  }

  let actualPriceVnd: number | undefined;
  if (outcome === 'PRICE_CHANGED') {
    const price = Number(submission.actualPriceVnd);
    if (!Number.isInteger(price) || price <= 0) {
      return { ok: false, error: 'PRICE_CHANGED needs the price the broker actually quoted, in whole dong.' };
    }
    actualPriceVnd = price;
  } else if (submission.actualPriceVnd != null) {
    return { ok: false, error: `${outcome} does not take a price.` };
  }

  if (outcome === 'NO_RESPONSE' && context.priorNudges < NUDGES_BEFORE_NO_RESPONSE) {
    // "No response" after one attempt is "we have not chased them yet", and the
    // difference matters: one becomes a nudge, the other closes the item.
    return {
      ok: false,
      error: `NO_RESPONSE needs ${NUDGES_BEFORE_NO_RESPONSE} nudges first - this item has ${context.priorNudges}.`,
    };
  }

  const note = typeof submission.note === 'string' ? submission.note.trim().slice(0, 2000) : '';

  return {
    ok: true,
    value: { outcome, slots: slots.value, actualPriceVnd, ...(note ? { note } : {}) },
  };
}

/**
 * The event payload. Snake_case because that is what the reducer reads and what
 * SPEC §3 documents; the camelCase above is the console's shape.
 */
export function outcomePayload(v: ValidatedOutcome): Record<string, unknown> {
  return {
    outcome: v.outcome,
    slots: v.slots.map(s => ({ starts_at: s.startsAt, duration_minutes: s.durationMinutes })),
    ...(v.actualPriceVnd != null ? { actual_price_vnd: v.actualPriceVnd } : {}),
    ...(v.note ? { note: v.note } : {}),
  };
}

/** `OPS:<uuid>` per SPEC §1. An operator's actions are attributable, always. */
export function opsActor(userId: string): string {
  return `OPS:${userId}`;
}

/**
 * UNREACHABLE also enqueues the listing for realtor re-resolution (SPEC §4).
 *
 * A dead number is not just this request's problem - it is wrong on every
 * future listing from that broker, and the resolution ops does by hand next
 * week is the one they could have skipped.
 */
export function jobsForOutcome(
  v: ValidatedOutcome,
  item: { itemId: string; listingId: string; requestId?: string },
) {
  if (v.outcome !== 'UNREACHABLE') return [];
  return [{
    kind: 'RESOLVE_REALTOR',
    run_after: new Date().toISOString(),
    // request_id is what the console's Flagged panel filters on. Without it
    // the to-do existed and was shown on no request.
    payload: {
      listing_id: item.listingId,
      item_id: item.itemId,
      request_id: item.requestId ?? null,
      reason: 'UNREACHABLE',
    },
  }];
}
