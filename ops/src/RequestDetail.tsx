// One request: its availability, and a card per shortlisted unit.
//
// Every card carries the broker's number, a copyable Vietnamese draft, and the
// seven outcome actions. Nothing here writes to the database directly - the
// console has SELECT only, and each action posts to `ops-record-outcome`, which
// is where SPEC §4 is enforced.
//
// Note what the screen does not show: who the renter is. No policy grants this
// console `renters` or `messages`, so there is nothing to render even by
// accident (invariant 4). A request is worked by its ref.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { reduceRequest, summarise, type DomainEvent, type RequestView } from '../../supabase/functions/_shared/viewing-domain';
import { formatVnd, hcmc } from '../../supabase/functions/_shared/viewing/triage';
import { OutcomeForm } from './OutcomeForm';
import { draftForRealtor } from './draft';
import { Deliver } from './Deliver';
import type { StopListing } from '../../supabase/functions/_shared/viewing/itinerary';

interface Item {
  id: string;
  request_id: string;
  request_ref: string;
  listing_id: string;
  realtor_id: string | null;
  price_vnd_at_request: number;
  sort_order: number | null;
  realtor_phone: string | null;
  realtor_name: string | null;
  listing_title: string | null;
  listing_url: string | null;
  district_code: string | null;
  bedrooms: number | null;
  area_sqm: number | null;
}

interface RequestRow {
  id: string;
  ref: string;
  availability: { date: string; part: string }[];
  created_at: string;
}

export function RequestDetail({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<RequestView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: req }, { data: rows }, { data: events, error: eErr }] = await Promise.all([
      supabase.from('ops_request_queue').select('id, ref, availability, created_at').eq('id', requestId).maybeSingle(),
      supabase.from('ops_request_items_view').select('*').eq('request_id', requestId).order('sort_order'),
      supabase.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
        .eq('request_id', requestId).order('occurred_at', { ascending: true }),
    ]);
    if (eErr) { setError(eErr.message); return; }
    setRequest((req as RequestRow) ?? null);
    setItems((rows ?? []) as Item[]);
    setView(reduceRequest(requestId, (events ?? []) as DomainEvent[]));
    setError(null);
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!request || !view) return <p className="muted">Loading...</p>;

  const s = summarise(view);

  return (
    <>
      <div className="row wrap-row" style={{ marginBottom: 4 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{request.ref}</h2>
        <span className="tag">{view.state}</span>
        <span className="muted small">
          {s.confirmed} of {s.total} confirmed
          {s.unresolved > 0 ? `, ${s.unresolved} still open` : ''}
        </span>
        <div className="spacer" />
        <button onClick={() => void load()}>Refresh</button>
      </div>

      <p className="small muted" style={{ marginTop: 0 }}>
        Requested {hcmc(request.created_at)}. Renter is free:{' '}
        {(request.availability ?? []).map(w => `${w.date} ${w.part.toLowerCase()}`).join(', ') || 'not stated'}
      </p>

      {items.map(item => (
        <ItemCard
          key={item.id}
          item={item}
          view={view}
          availability={request.availability ?? []}
          onChanged={load}
        />
      ))}

      {/* Only once every broker has answered. Ordering an itinerary while
          replies are outstanding invites sending a partial one early, and the
          renter can only be told the plan once. */}
      {s.unresolved === 0 && items.length > 0 && (
        <Deliver
          requestId={requestId}
          ref={request.ref}
          view={view}
          listings={items.map<StopListing>(i => ({
            itemId: i.id,
            listingTitle: i.listing_title ?? 'A place',
            districtCode: i.district_code,
            priceVndAtRequest: i.price_vnd_at_request,
          }))}
          onDelivered={load}
        />
      )}

      <button onClick={onBack}>&larr; Back to queue</button>
    </>
  );
}

function ItemCard({
  item,
  view,
  availability,
  onChanged,
}: {
  item: Item;
  view: RequestView;
  availability: { date: string; part: string }[];
  onChanged: () => void;
}) {
  const state = view.items[item.id];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('ops-record-outcome', {
      body: { itemId: item.id, ...body },
    });
    setBusy(false);
    const payload = data as { error?: string; message?: string } | null;
    if (err || payload?.error) {
      setError(payload?.message ?? payload?.error ?? err?.message ?? 'Failed');
      return false;
    }
    onChanged();
    return true;
  };

  const draft = draftForRealtor({
    listingTitle: item.listing_title ?? 'the listing',
    listingUrl: item.listing_url,
    priceVnd: item.price_vnd_at_request,
    availability,
  });

  const copyDraft = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const settled = state && state.state !== 'PENDING' && state.state !== 'CONTACTED';

  return (
    <div className="card">
      <div className="row wrap-row">
        <strong>{item.listing_title ?? item.listing_id}</strong>
        <span className="tag">{state?.state ?? 'PENDING'}</span>
        <div className="spacer" />
        <span className="small muted">
          {formatVnd(item.price_vnd_at_request)}
          {item.bedrooms != null ? ` - ${item.bedrooms} bed` : ''}
          {item.area_sqm != null ? ` - ${item.area_sqm} m2` : ''}
          {item.district_code ? ` - ${item.district_code}` : ''}
        </span>
      </div>

      <div className="row wrap-row small" style={{ marginTop: 6 }}>
        {item.realtor_phone
          ? <a href={`tel:${item.realtor_phone}`}>{item.realtor_phone}</a>
          : <span className="tag warn">no contact resolved</span>}
        {item.realtor_name && <span className="muted">{item.realtor_name}</span>}
        {item.listing_url && <a href={item.listing_url} target="_blank" rel="noreferrer">source</a>}
        {state && state.nudges > 0 && <span className="muted">nudged {state.nudges}x</span>}
      </div>

      {!settled && (
        <>
          <textarea rows={4} readOnly value={draft} style={{ marginTop: 8 }} />
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => void copyDraft()}>{copied ? 'Copied' : 'Copy draft'}</button>
            <button
              disabled={busy || state?.state === 'CONTACTED'}
              onClick={() => void post({ action: 'CONTACTED', channel: 'ZALO' })}
            >
              Mark sent
            </button>
            <button disabled={busy || state?.state !== 'CONTACTED'} onClick={() => void post({ action: 'NUDGE' })}>
              Nudge
            </button>
          </div>

          <OutcomeForm
            busy={busy}
            nudges={state?.nudges ?? 0}
            availability={availability}
            onSubmit={body => post({ action: 'OUTCOME', ...body })}
          />
        </>
      )}

      {settled && state && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          {state.outcome}
          {state.actualPriceVnd != null ? ` - quoted ${formatVnd(state.actualPriceVnd)}` : ''}
          {state.slots.length > 0
            ? ` - ${state.slots.map(s => hcmc((s as { starts_at: string }).starts_at)).join(', ')}`
            : ''}
        </p>
      )}

      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
