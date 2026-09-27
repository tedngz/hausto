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
//
// Paste-parse: with the agent's reply pasted, "Suggest from reply" asks the
// model for a reading and fills the form in. It fills, never submits - the
// operator reads it, fixes anything wrong and presses Record, and what the
// model suggested travels with the event so agreement can be measured.

import { useState } from 'react';
import {
  OUTCOMES,
  NUDGES_BEFORE_NO_RESPONSE,
  validateOutcome,
  type Outcome,
} from '../../supabase/functions/_shared/viewing/outcomes';
import type { ParseSuggestion } from '../../supabase/functions/_shared/viewing/parse-reply';
import { DAY_PART_HOURS } from '../../supabase/functions/_shared/viewing/intake';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';

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

const DURATIONS = [30, 45, 60, 90];

/** A local Ho Chi Minh City date and time as the explicit-offset instant stored (SPEC §7). */
function localInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00+07:00`).toISOString();
}

/** The renter's windows, as concrete start times the operator can tick. */
function windowOptions(availability: { date: string; part: string }[]) {
  return availability.map(w => {
    const hour = DAY_PART_HOURS[w.part as keyof typeof DAY_PART_HOURS]?.suggested ?? 10;
    const time = `${String(hour).padStart(2, '0')}:00`;
    return { label: `${w.date} ${w.part.toLowerCase()} (${time})`, startsAt: localInstant(w.date, time) };
  });
}

export function OutcomeForm({
  busy,
  nudges,
  availability,
  onSubmit,
  onSaveReply,
  onSuggest,
}: {
  busy: boolean;
  nudges: number;
  availability: { date: string; part: string }[];
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
  /** Store the agent's reply on its own, when it settles nothing yet. */
  onSaveReply: (body: Record<string, unknown>) => Promise<boolean>;
  /** Ask the parser what the reply says. Null when it could not answer. */
  onSuggest: (reply: string) => Promise<ParseSuggestion | null>;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  // Times the agent named that are not one of the renter's windows (gap 6):
  // "10:30", "Saturday instead". Offered alongside the windows once added.
  const [extra, setExtra] = useState<string[]>([]);
  const [customDate, setCustomDate] = useState(availability[0]?.date ?? '');
  const [customTime, setCustomTime] = useState('10:00');
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  // The agent's words, pasted from Zalo. Stored next to the outcome read from
  // them - that pair is the corpus. Never parsed here, never changes state.
  const [reply, setReply] = useState('');
  const [replyKey, setReplyKey] = useState(() => crypto.randomUUID());
  const [suggestion, setSuggestion] = useState<ParseSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const windows = windowOptions(availability);
  const options = [
    ...windows,
    ...extra.filter(t => !windows.some(w => w.startsAt === t)).map(t => ({ label: hcmc(t), startsAt: t })),
  ];

  const reset = () => {
    setOutcome(null); setSlots([]); setExtra([]); setPrice(''); setNote(''); setDuration(30);
    setReply(''); setReplyKey(crypto.randomUUID()); setSuggestion(null); setSuggestError(null);
  };

  const addCustom = () => {
    if (!customDate || !customTime) return;
    const t = localInstant(customDate, customTime);
    setExtra(prev => (prev.includes(t) ? prev : [...prev, t]));
    setSlots(prev => (prev.includes(t) ? prev : [...prev, t]));
  };

  const suggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    const s = await onSuggest(reply);
    setSuggesting(false);
    if (!s) { setSuggestError('Could not read that reply - pick the outcome yourself.'); return; }
    setSuggestion(s);
    setOutcome(s.outcome);
    const times = s.slots.map(x => x.startsAt);
    setExtra(times);
    setSlots(times);
    if (s.slots[0]) setDuration(s.slots[0].durationMinutes);
    setPrice(s.actualPriceVnd != null ? String(s.actualPriceVnd) : '');
    setNote(s.note);
  };

  const replyFields = reply.trim() ? { realtorReply: reply, clientKey: replyKey } : {};
  // What the model said, sent with the event so agreement is measurable
  // (AI operator plan, stage 1). Never read back to decide anything.
  const suggestedFields = suggestion ? { suggested: suggestion } : {};

  const body = outcome
    ? {
        outcome,
        slots: NEEDS_SLOT.includes(outcome) ? slots.map(s => ({ startsAt: s, durationMinutes: duration })) : undefined,
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
      <textarea
        rows={2}
        placeholder="Paste the agent's reply from Zalo (stored with the outcome)"
        value={reply}
        onChange={e => { setReply(e.target.value); setSuggestion(null); }}
        style={{ marginBottom: 6 }}
      />
      {reply.trim() && (
        <div className="row wrap-row" style={{ marginBottom: 6 }}>
          <button disabled={busy || suggesting} onClick={() => void suggest()}>
            {suggesting ? 'Reading...' : 'Suggest from reply'}
          </button>
          {!outcome && (
            <button
              disabled={busy}
              onClick={async () => {
                if (await onSaveReply({ channel: 'ZALO', message: reply, clientKey: replyKey })) reset();
              }}
            >
              Save reply only
            </button>
          )}
          {suggestion && (
            <span className={`small ${suggestion.confidence === 'HIGH' ? 'muted' : 'age-warn'}`}>
              Suggested{suggestion.confidence === 'LOW' ? ' (unsure)' : ''} - check it before recording.
            </span>
          )}
          {suggestError && <span className="small age-warn">{suggestError}</span>}
        </div>
      )}
      {suggestion && suggestion.problems.length > 0 && (
        <ul className="small age-warn" style={{ margin: '0 0 6px', paddingLeft: 18 }}>
          {suggestion.problems.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}

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
            onClick={() => { setOutcome(outcome === o ? null : o); }}
          >
            {LABEL[o]}
          </button>
        ))}
      </div>

      {outcome && NEEDS_SLOT.includes(outcome) && (
        <div style={{ marginTop: 8 }}>
          <div className="small muted">Which time?</div>
          {options.length === 0 && <div className="small">No windows from the renter - add the agent's time below.</div>}
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
          <div className="row wrap-row small" style={{ marginTop: 6 }}>
            <span className="muted">Another time (HCMC):</span>
            <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)} />
            <input type="time" value={customTime} step={300} onChange={e => setCustomTime(e.target.value)} />
            <button disabled={!customDate || !customTime} onClick={addCustom}>Add</button>
            <span className="muted">Length:</span>
            <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
              {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
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
              onClick={async () => {
                if (body && await onSubmit({ ...body, ...replyFields, ...suggestedFields })) reset();
              }}
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
