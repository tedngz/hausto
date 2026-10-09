// Ordering the itinerary and sending it.
//
// Ops orders the stops by hand - route optimization is out of scope and they
// know the city better than a matrix would. What the panel does is show the
// two problems that are wrong regardless of local knowledge (an overlap, a
// district hop with no time to make it) and refuse to hide them.
//
// The preview is the actual rendered message, not an approximation of it. An
// operator about to spend a billed send on a renter's attention should be
// reading the thing that will arrive.

import { useMemo, useState } from 'react';
import { supabase, invokeFailure } from './supabase';
import {
  assembleItinerary,
  freeOnOtherDays,
  renderItinerary,
  renderNoSupply,
  renderOtherDays,
  renderAlternativesOnly,
  type StopListing,
} from '../../supabase/functions/_shared/viewing/itinerary';
import { VIEWINGS_PATH } from '../../supabase/functions/_shared/viewing/renter-view';
import { SITE_URL } from '../../supabase/functions/_shared/viewing/watch';
import type { RequestView } from '../../supabase/functions/_shared/viewing-domain';

export function Deliver({
  requestId,
  requestRef,
  view,
  listings,
  onDelivered,
}: {
  requestId: string;
  requestRef: string;
  view: RequestView;
  listings: StopListing[];
  onDelivered: () => void;
}) {
  const confirmedIds = useMemo(
    () => Object.values(view.items).filter(i => i.state === 'CONFIRMED').map(i => i.itemId),
    [view],
  );
  const [order, setOrder] = useState<string[]>(confirmedIds);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the order honest if an outcome changed underneath it.
  const effective = [...order.filter(id => confirmedIds.includes(id)),
                     ...confirmedIds.filter(id => !order.includes(id))];

  const assembled = assembleItinerary(view, listings, effective);
  const titleOf = (itemId: string) => listings.find(l => l.itemId === itemId)?.listingTitle ?? itemId;

  // The no-supply preview cannot show the real substitutes: they are chosen
  // server-side at send time, against the index as it stands then rather than
  // as it stood when this screen loaded. Nor its Priority search line, which
  // depends on the renter's Pass. Saying so beats showing an empty list an
  // operator would read as "there are none".
  // Same four branches as deliver.ts, so the preview is the message.
  const noStops = assembled.stops.length === 0;
  const busy = noStops && assembled.alternatives.length === 0 ? freeOnOtherDays(view, listings) : [];
  const otherDays = busy.length > 0;
  const preview = noStops && assembled.alternatives.length > 0
    ? renderAlternativesOnly({ ref: requestRef, requestedCount: listings.length, alternatives: assembled.alternatives })
    : otherDays
      ? renderOtherDays({
          ref: requestRef, requestedCount: listings.length, places: busy, changeTimesUrl: `${SITE_URL}${VIEWINGS_PATH}`,
        })
    : noStops
      ? renderNoSupply({ ref: requestRef, requestedCount: listings.length, substitutes: [] })
      : renderItinerary({
          ref: requestRef, stops: assembled.stops, requestedCount: listings.length, alternatives: assembled.alternatives,
        });
  // Asked already, and nothing has changed since: the renter's move.
  const askedForDays = otherDays && !!view.otherDaysAsked;

  const move = (i: number, delta: number) => {
    const next = [...effective];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const deliver = async () => {
    setSending(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('viewing-deliver', {
      body: { requestId, purpose: 'ITINERARY', order: effective },
    });
    setSending(false);
    const failure = await invokeFailure(data, err, 'Failed to send');
    if (failure) {
      setError(failure);
      return;
    }
    onDelivered();
  };

  const alreadySent = !!view.deliveredMessageId;
  // Their window was shut, so a template went instead and this waits for them.
  const held = !alreadySent && !!view.heldItinerary;

  return (
    <div className="card">
      <div className="row">
        <strong>Itinerary</strong>
        <span className="muted small">
          {assembled.stops.length} of {listings.length} confirmed
        </span>
        {alreadySent && <span className="tag good">already sent</span>}
        {held && <span className="tag warn">waiting on their reply</span>}
      </div>

      {held && (
        <p className="small" style={{ marginBottom: 4 }}>
          Their 24-hour window was shut, so a WhatsApp template told them the plan is ready and asked
          them to reply. This goes to them, as it stands then, the moment they do.
        </p>
      )}

      {noStops && assembled.alternatives.length > 0 && (
        <p className="small" style={{ marginBottom: 4 }}>
          Nothing confirmed at the renter's times, but {assembled.alternatives.length} agent
          {assembled.alternatives.length === 1 ? '' : 's'} offered others. Sending this lists them and
          asks the renter to choose. When they do, record it on the card with "Renter took an offered time".
        </p>
      )}

      {otherDays && (
        <p className="small" style={{ marginBottom: 4 }}>
          {askedForDays
            ? <>Asked the renter for other days {view.otherDaysAsked!.held ? '(waiting behind a template for their reply)' : ''}.
                New times from their Viewings tab send every agent back to be asked. Sending again repeats the question.</>
            : <>Nothing confirmed, but {busy.length === 1 ? 'one place was' : `${busy.length} places were`} only busy
                on those days, not rented. Sending this asks the renter for other days - it is not a plan, so their
                times stay open to change, and new ones send every agent back to be asked.</>}
        </p>
      )}

      {noStops && assembled.alternatives.length === 0 && !otherDays && (
        <p className="small" style={{ marginBottom: 4 }}>
          Nothing confirmed and nothing left. Sending this tells the renter so, and carries up to
          three close matches chosen at send time - same districts, same bedroom count, within
          their price band. With none, it offers Priority search instead, filled in from this
          request, worded for whether they hold the Pass. The preview below shows the wording,
          not the actual picks.
        </p>
      )}

      {effective.map((itemId, i) => (
        <div key={itemId} className="row small" style={{ marginTop: 4 }}>
          <button onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
          <button onClick={() => move(i, 1)} disabled={i === effective.length - 1}>↓</button>
          <span>{i + 1}. {titleOf(itemId)}</span>
        </div>
      ))}

      {assembled.warnings.length > 0 && (
        <ul className="small" style={{ marginTop: 8, paddingLeft: 18 }}>
          {assembled.warnings.map((w, i) => (
            <li key={i} className={w.kind === 'OVERLAP' ? 'age-late' : 'age-warn'}>
              {w.kind === 'OVERLAP' ? 'Clash' : w.kind === 'DISTRICT_HOP' ? 'Tight' : 'Unknown'}: {w.message}
            </li>
          ))}
        </ul>
      )}

      <div className="small muted" style={{ marginTop: 8 }}>What the renter will get:</div>
      <textarea rows={Math.min(16, preview.split('\n').length + 1)} readOnly value={preview} />

      <div className="row" style={{ marginTop: 6 }}>
        <button
          className="primary"
          disabled={sending || assembled.warnings.some(w => w.kind === 'OVERLAP')}
          onClick={() => void deliver()}
          title={
            assembled.warnings.some(w => w.kind === 'OVERLAP')
              ? 'Two viewings clash - fix the order or the times first'
              : undefined
          }
        >
          {sending ? 'Sending...' : alreadySent || askedForDays ? 'Send again' : otherDays ? 'Ask for other days' : 'Send itinerary'}
        </button>
        {alreadySent && <span className="small muted">Re-sending is deduplicated unless the attempt changes.</span>}
      </div>

      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
