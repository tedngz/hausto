// The seven actions (SPEC §4).
//
// One button each, no free-text outcome, and the note sits in its own box that
// is carried to the event and never parsed. That is the constraint the whole
// milestone exists to hold: a text box that changes state destroys the corpus
// this is being built to produce.
//
// Buttons grey out for the same reasons the server refuses - the rules come
// from the shared module, so the console cannot disagree with the endpoint
// about what an outcome requires.

import { useState } from 'react';
import {
  OUTCOMES,
  NUDGES_BEFORE_NO_RESPONSE,
  validateOutcome,
  type Outcome,
} from '../../supabase/functions/_shared/viewing/outcomes';

const LABEL: Record<Outcome, string> = {
  CONFIRMED: 'Confirmed a slot',
  ALTERNATIVE_OFFERED: 'Offered other times',
  UNAVAILABLE_DATE: 'Not available then',
  ALREADY_RENTED: 'Already rented',
  PRICE_CHANGED: 'Different price',
  NO_RESPONSE: 'No response',
  UNREACHABLE: 'Wrong or dead number',
};

const NEEDS_SLOT: Outcome[] = ['CONFIRMED', 'ALTERNATIVE_OFFERED'];

/** The renter's windows, as concrete start times the operator can tick. */
function slotOptionsFor(availability: { date: string; part: string }[]) {
  const HOUR: Record<string, number> = { MORNING: 9, AFTERNOON: 14, EVENING: 18 };
  return availability.map(w => {
    const hour = HOUR[w.part] ?? 10;
    // The renter said a window in Ho Chi Minh City time; the slot is stored as
    // a UTC instant (SPEC §7). +07:00 is explicit so neither end guesses.
    const startsAt = `${w.date}T${String(hour).padStart(2, '0')}:00:00+07:00`;
    return { label: `${w.date} ${w.part.toLowerCase()} (${hour}:00)`, startsAt };
  });
}

export function OutcomeForm({
  busy,
  nudges,
  availability,
  onSubmit,
}: {
  busy: boolean;
  nudges: number;
  availability: { date: string; part: string }[];
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');

  const options = slotOptionsFor(availability);

  const reset = () => { setOutcome(null); setSlots([]); setPrice(''); setNote(''); };

  const body = outcome
    ? {
        outcome,
        slots: NEEDS_SLOT.includes(outcome) ? slots.map(s => ({ startsAt: s, durationMinutes: 30 })) : undefined,
        actualPriceVnd: outcome === 'PRICE_CHANGED' && price ? Number(price) : undefined,
        note: note || undefined,
      }
    : null;

  // The same check the endpoint runs, so the button is disabled for the reason
  // the server would have given - rather than the operator pressing it and
  // being told no.
  const check = body ? validateOutcome(body, { priorNudges: nudges }) : null;

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row wrap-row">
        {OUTCOMES.map(o => (
          <button
            key={o}
            className={outcome === o ? 'primary' : ''}
            disabled={busy || (o === 'NO_RESPONSE' && nudges < NUDGES_BEFORE_NO_RESPONSE)}
            title={
              o === 'NO_RESPONSE' && nudges < NUDGES_BEFORE_NO_RESPONSE
                ? `Nudge ${NUDGES_BEFORE_NO_RESPONSE - nudges} more time(s) first`
                : undefined
            }
            onClick={() => { setOutcome(outcome === o ? null : o); setSlots([]); }}
          >
            {LABEL[o]}
          </button>
        ))}
      </div>

      {outcome && NEEDS_SLOT.includes(outcome) && (
        <div style={{ marginTop: 8 }}>
          <div className="small muted">Which time?</div>
          {options.length === 0 && <div className="small">The renter gave no windows - nothing to tick.</div>}
          {options.map(o => (
            <label key={o.startsAt} className="small" style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={slots.includes(o.startsAt)}
                onChange={e =>
                  setSlots(prev => (e.target.checked ? [...prev, o.startsAt] : prev.filter(s => s !== o.startsAt)))}
              />{' '}
              {o.label}
            </label>
          ))}
        </div>
      )}

      {outcome === 'PRICE_CHANGED' && (
        <div style={{ marginTop: 8 }}>
          <input
            placeholder="Price the broker quoted, in dong"
            inputMode="numeric"
            value={price}
            onChange={e => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
          />
        </div>
      )}

      {outcome && (
        <>
          <textarea
            rows={2}
            placeholder="Note (never parsed, never changes anything)"
            value={note}
            onChange={e => setNote(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="primary"
              disabled={busy || !check?.ok}
              onClick={async () => { if (body && await onSubmit(body)) reset(); }}
            >
              Record {LABEL[outcome].toLowerCase()}
            </button>
            <button onClick={reset} disabled={busy}>Cancel</button>
            {check && !check.ok && <span className="small muted">{check.error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
