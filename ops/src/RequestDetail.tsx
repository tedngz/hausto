// One request: the renter's thread, and a card per shortlisted unit.
//
// Every card carries the broker's number, a Vietnamese draft the operator can
// edit before sending, and the seven outcome actions. Nothing here writes to
// the database directly - the console has SELECT only, and each action posts to
// `ops-record-outcome`, which is where SPEC §4 is enforced.
//
// What the operator sends a broker and what the broker says back are stored
// (`realtor_messages`). The draft is editable because the edits are the signal:
// they are what a generated draft will be trained against.
//
// Note what the screen does not show: who the renter is. The thread comes from
// `ops_request_thread()`, which returns message bodies and never the renter's
// number or name (invariant 4). A request is worked by its ref.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import {
  reduceRequest,
  summarise,
  type DomainEvent,
  type RequestView,
  type RealtorDecision,
} from '../../supabase/functions/_shared/viewing-domain';
import { formatVnd, hcmc } from '../../supabase/functions/_shared/viewing/triage';
import { waitingReplies } from '../../supabase/functions/_shared/viewing/thread';
import { realtorDecisionsOwed } from '../../supabase/functions/_shared/viewing/reminders';
import {
  draftForRealtor,
  nudgeDraft,
  confirmDraft,
  releaseDraft,
} from '../../supabase/functions/_shared/realtor/drafts';
import { OutcomeForm } from './OutcomeForm';
import { Deliver } from './Deliver';
import { Tasks } from './Tasks';
import { RenterThread, type Thread } from './RenterThread';
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

export interface RealtorMessage {
  id: string;
  item_id: string | null;
  direction: 'OUT' | 'IN';
  purpose: string;
  body: string;
  status: string;
  created_at: string;
}

const PURPOSE: Record<string, string> = {
  REQUEST_VIEWING: 'Asked',
  NUDGE: 'Nudged',
  CONFIRM: 'Confirmed',
  RELEASE: 'Released',
  REPLY: 'Agent',
};

export function RequestDetail({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [view, setView] = useState<RequestView | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [transcript, setTranscript] = useState<RealtorMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: req }, { data: rows }, { data: evs, error: eErr }, { data: th, error: tErr }, { data: rm }] =
      await Promise.all([
        supabase.from('ops_request_queue').select('id, ref, availability, created_at').eq('id', requestId).maybeSingle(),
        supabase.from('ops_request_items_view').select('*').eq('request_id', requestId).order('sort_order'),
        supabase.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
          .eq('request_id', requestId).order('occurred_at', { ascending: true }),
        supabase.rpc('ops_request_thread', { _request_id: requestId }),
        supabase.from('realtor_messages').select('id, item_id, direction, purpose, body, status, created_at')
          .eq('request_id', requestId).order('created_at', { ascending: true }),
      ]);
    if (eErr) { setError(eErr.message); return; }
    // The thread failing (an old database without the function, say) must not
    // take the broker side down with it.
    if (tErr) console.warn('ops_request_thread failed:', tErr.message);
    setRequest((req as RequestRow) ?? null);
    setItems((rows ?? []) as Item[]);
    setEvents((evs ?? []) as DomainEvent[]);
    setView(reduceRequest(requestId, (evs ?? []) as DomainEvent[]));
    setThread((th as Thread) ?? null);
    setTranscript((rm ?? []) as RealtorMessage[]);
    setError(null);
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!request || !view) return <p className="muted">Loading...</p>;

  const s = summarise(view);
  const owed = new Map(realtorDecisionsOwed(view).map(o => [o.itemId, o.decision]));

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

      <RenterThread
        requestId={requestId}
        state={view.state}
        thread={thread}
        waiting={waitingReplies(events)}
        onChanged={load}
      />

      <Tasks
        requestId={requestId}
        titleFor={id => items.find(i => i.id === id)?.listing_title ?? id}
      />

      {items.map(item => (
        <ItemCard
          key={item.id}
          item={item}
          view={view}
          availability={request.availability ?? []}
          transcript={transcript.filter(m => m.item_id === item.id)}
          owed={owed.get(item.id) ?? null}
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
  transcript,
  owed,
  onChanged,
}: {
  item: Item;
  view: RequestView;
  availability: { date: string; part: string }[];
  transcript: RealtorMessage[];
  owed: RealtorDecision | null;
  onChanged: () => void;
}) {
  const state = view.items[item.id];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);

  const title = item.listing_title ?? 'the listing';

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

  const settled = state && state.state !== 'PENDING' && state.state !== 'CONTACTED';
  const firstSlot = (state?.slots[0] as { starts_at?: string } | undefined)?.starts_at ?? null;

  return (
    <div className="card">
      <div className="row wrap-row">
        <strong>{item.listing_title ?? item.listing_id}</strong>
        <span className="tag">{state?.state ?? 'PENDING'}</span>
        {state?.notified && <span className="tag good">agent told: {state.notified.toLowerCase()}</span>}
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
        {item.realtor_phone && !editingContact && (
          <button className="link" onClick={() => setEditingContact(true)}>change number</button>
        )}
      </div>

      {(!item.realtor_phone || editingContact) && (
        <ContactForm
          busy={busy}
          onCancel={item.realtor_phone ? () => setEditingContact(false) : undefined}
          onSave={async (phone, name) => {
            const ok = await post({ action: 'RECORD_CONTACT', phone, name });
            if (ok) setEditingContact(false);
            return ok;
          }}
        />
      )}

      {!settled && state?.state !== 'CONTACTED' && (
        <SendBox
          key="ask"
          busy={busy}
          initial={draftForRealtor({
            listingTitle: title,
            listingUrl: item.listing_url,
            priceVnd: item.price_vnd_at_request,
            availability,
          })}
          label="Mark sent"
          onSend={message => post({ action: 'CONTACTED', channel: 'ZALO', message })}
        />
      )}

      {!settled && state?.state === 'CONTACTED' && (
        <SendBox
          key={`nudge-${state.nudges}`}
          busy={busy}
          initial={nudgeDraft({ listingTitle: title })}
          label="Mark nudge sent"
          onSend={message => post({ action: 'NUDGE', channel: 'ZALO', message })}
        />
      )}

      {!settled && (
        <OutcomeForm
          busy={busy}
          nudges={state?.nudges ?? 0}
          availability={availability}
          onSubmit={body => post({ action: 'OUTCOME', ...body })}
          onSaveReply={body => post({ action: 'REALTOR_REPLY', ...body })}
        />
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

      {owed && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <div className="small">
            <span className={`tag ${owed === 'CONFIRM' ? 'good' : 'warn'}`}>
              {owed === 'CONFIRM' ? 'Confirm with the agent' : 'Release the agent'}
            </span>{' '}
            <span className="muted">
              {owed === 'CONFIRM'
                ? 'The renter kept this viewing. Tell the agent to hold the time.'
                : 'The renter is not coming. Tell the agent to stop holding the time.'}
            </span>
          </div>
          <SendBox
            key={`notify-${owed}`}
            busy={busy}
            initial={owed === 'CONFIRM'
              ? confirmDraft({ listingTitle: title, startsAt: firstSlot })
              : releaseDraft({ listingTitle: title })}
            label="Mark sent"
            onSend={message => post({ action: 'NOTIFY_REALTOR', decision: owed, channel: 'ZALO', message })}
          />
        </div>
      )}

      {transcript.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="small muted">Agent conversation ({transcript.length})</summary>
          <div className="thread">
            {transcript.map(m => (
              <div key={m.id} className={`bubble ${m.direction === 'IN' ? 'in' : 'out'}`}>
                <div className="small muted">{PURPOSE[m.purpose] ?? m.purpose} - {hcmc(m.created_at)}</div>
                <div className="body">{m.body}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

/**
 * A draft the operator copies to Zalo, edits if they need to, and then records
 * as sent. What is recorded is what is in the box - the edited text, not the
 * template - because that is what the broker actually read.
 */
function SendBox({
  busy,
  initial,
  label,
  onSend,
}: {
  busy: boolean;
  initial: string;
  label: string;
  onSend: (message: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <textarea rows={5} value={text} onChange={e => setText(e.target.value)} style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="primary" disabled={busy || !text.trim()} onClick={() => void onSend(text)}>
          {label}
        </button>
        {text !== initial && (
          <button className="link" disabled={busy} onClick={() => setText(initial)}>reset to draft</button>
        )}
      </div>
    </>
  );
}

/** Saving a number the operator found - from a phone call, the source site, a colleague. */
function ContactForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (phone: string, name: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="row wrap-row" style={{ marginTop: 8 }}>
      <input placeholder="Agent phone, e.g. 0901234567" value={phone} onChange={e => setPhone(e.target.value)} />
      <input placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
      <button className="primary" disabled={busy || !phone.trim()} onClick={() => void onSave(phone, name)}>
        Save contact
      </button>
      {onCancel && <button disabled={busy} onClick={onCancel}>Cancel</button>}
    </div>
  );
}
