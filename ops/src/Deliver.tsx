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
import { supabase } from './supabase';
import {
  assembleItinerary,
  renderItinerary,
  renderNoSupply,
  renderAlternativesOnly,
  type StopListing,
} from '../../supabase/functions/_shared/viewing/itinerary';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the order honest if an outcome changed underneath it.
  const effective = [...order.filter(id => confirmedIds.includes(id)),
                     ...confirmedIds.filter(id => !order.includes(id))];

  const assembled = assembleItinerary(view, listings, effective);
  const titleOf = (itemId: string) => listings.find(l => l.itemId === itemId)?.listingTitle ?? itemId;

  // The no-supply preview cannot show the real substitutes: they are chosen
  // server-side at send time, against the index as it stands then rather than
  // as it stood when this screen loaded. Saying so beats showing an empty list
  // an operator would read as "there are none".
  // Same three branches as deliver.ts, so the preview is the message.
  const noStops = assembled.stops.length === 0;
  const preview = noStops && assembled.alternatives.length > 0
    ? renderAlternativesOnly({ ref: requestRef, requestedCount: listings.length, alternatives: assembled.alternatives })
    : noStops
      ? renderNoSupply({ ref: requestRef, requestedCount: listings.length, substitutes: [] })
      : renderItinerary({
          ref: requestRef, stops: assembled.stops, requestedCount: listings.length, alternatives: assembled.alternatives,
        });

  const move = (i: number, delta: number) => {
    const next = [...effective];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const deliver = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('viewing-deliver', {
      body: { requestId, purpose: 'ITINERARY', order: effective },
    });
    setBusy(false);
    const payload = data as { error?: string; message?: string } | null;
    if (err || payload?.error) {
      setError(payload?.message ?? payload?.error ?? err?.message ?? 'Failed to send');
      return;
    }
    onDelivered();
  };

  const alreadySent = !!view.deliveredMessageId;

  return (
    <div className="card">
      <div className="row">
        <strong>Itinerary</strong>
        <span className="muted small">
          {assembled.stops.length} of {listings.length} confirmed
        </span>
        {alreadySent && <span className="tag good">already sent</span>}
      </div>

      {noStops && assembled.alternatives.length > 0 && (
        <p className="small" style={{ marginBottom: 4 }}>
          Nothing confirmed at the renter's times, but {assembled.alternatives.length} agent
          {assembled.alternatives.length === 1 ? '' : 's'} offered others. Sending this lists them and
          asks the renter to choose. When they do, record it on the card with "Renter took an offered time".
        </p>
      )}

      {noStops && assembled.alternatives.length === 0 && (
        <p className="small" style={{ marginBottom: 4 }}>
          Nothing confirmed. Sending this tells the renter so, and carries up to
          three close matches chosen at send time - same districts, same bedroom
          count, within their price band. The preview below shows the wording,
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
          disabled={busy || assembled.warnings.some(w => w.kind === 'OVERLAP')}
          onClick={() => void deliver()}
          title={
            assembled.warnings.some(w => w.kind === 'OVERLAP')
              ? 'Two viewings clash - fix the order or the times first'
              : undefined
          }
        >
          {busy ? 'Sending...' : alreadySent ? 'Send again' : 'Send itinerary'}
        </button>
        {alreadySent && <span className="small muted">Re-sending is deduplicated unless the attempt changes.</span>}
      </div>

      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
