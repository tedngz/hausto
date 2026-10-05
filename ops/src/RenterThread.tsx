// The renter's side of the request: what they said, and a way to answer.
//
// Before this, a reschedule, a question or a decline was logged and read by
// nobody. The thread comes from `ops_request_thread()`, which returns bodies and
// times and never the renter's number or name (invariant 4) - the console
// still has no grant on `messages` or `renters`, and this does not add one.
//
// The reply box is only live when a free-form send is legal: the 24-hour window
// is open, the renter has not opted out, and we have not already sent two in a
// row. The server checks all of it again; this is so the operator is not asked
// to write something that cannot be sent.

import { useState } from 'react';
import { supabase, invokeFailure } from './supabase';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';
import { checkOperatorReply, type WaitingReply } from '../../supabase/functions/_shared/viewing/thread';
import type { RequestState } from '../../supabase/functions/_shared/viewing-domain';

export interface Thread {
  window_expires_at: string | null;
  opted_out: boolean;
  consecutive_outbound: number;
  messages: {
    id: string;
    direction: 'IN' | 'OUT';
    body: string;
    template_name: string | null;
    status: string;
    created_at: string;
  }[];
}

/** send.ts refuses a third outbound with no inbound between. */
const MAX_CONSECUTIVE = 2;

function newKey(): string {
  return crypto.randomUUID();
}

export function RenterThread({
  requestId,
  state,
  thread,
  waiting,
  onChanged,
}: {
  requestId: string;
  state: RequestState;
  thread: Thread | null;
  waiting: WaitingReply[];
  onChanged: () => void;
}) {
  const [text, setText] = useState('');
  // One key per composed message: a double-click or a retry of this text is
  // the same message, and clearing the box starts a new one.
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!thread) return null;

  const waitingIds = new Set(waiting.map(w => w.messageId));
  const windowOpen = !!thread.window_expires_at && Date.parse(thread.window_expires_at) > Date.now();
  const blocked = thread.opted_out
    ? 'Renter opted out - nothing can be sent.'
    : !windowOpen
      ? 'The 24-hour window is closed. The renter has to message first.'
      : thread.consecutive_outbound >= MAX_CONSECUTIVE
        ? 'Two messages already sent since the renter last wrote. Wait for them.'
        : null;
  const check = text.trim() ? checkOperatorReply(text, state) : null;

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('ops-record-outcome', {
      body: { requestId, ...body },
    });
    setBusy(false);
    const failure = await invokeFailure(data, err);
    if (failure) {
      setError(failure);
      return false;
    }
    onChanged();
    return true;
  };

  const send = async () => {
    if (await post({ action: 'REPLY', message: text, clientKey: key })) {
      setText('');
      setKey(newKey());
    }
  };

  return (
    <div className="card">
      <div className="row wrap-row">
        <strong>Renter on WhatsApp</strong>
        {waiting.length > 0 && <span className="tag bad">{waiting.length} waiting on us</span>}
        <div className="spacer" />
        <span className="small muted">
          {thread.opted_out
            ? 'opted out'
            : windowOpen
              ? `window open until ${hcmc(thread.window_expires_at!)}`
              : 'window closed'}
        </span>
      </div>

      {thread.messages.length === 0 && <p className="small muted">Nothing yet - the renter has not messaged us.</p>}
      <div className="thread">
        {thread.messages.map(m => (
          <div
            key={m.id}
            className={`bubble ${m.direction === 'IN' ? 'in' : 'out'}${waitingIds.has(m.id) ? ' waiting' : ''}`}
          >
            <div className="small muted">
              {m.direction === 'IN' ? 'Renter' : 'Us'} - {hcmc(m.created_at)}
              {m.direction === 'OUT' && m.status !== 'SENT' ? ` - ${m.status.toLowerCase()}` : ''}
            </div>
            <div className="body">{m.template_name ? `[template ${m.template_name}]` : m.body}</div>
          </div>
        ))}
      </div>

      {waiting.length > 0 && (
        <p className="small" style={{ marginBottom: 0 }}>
          Waiting: {waiting.map(w => w.intent.toLowerCase()).join(', ')}.{' '}
          <button disabled={busy} onClick={() => void post({ action: 'ACK_REPLIES' })}>No reply needed</button>
        </p>
      )}

      {blocked
        ? <p className="small muted" style={{ marginBottom: 0 }}>{blocked}</p>
        : (
          <>
            <textarea
              rows={3}
              placeholder="Reply to the renter (English, one message, no phone numbers)"
              value={text}
              onChange={e => setText(e.target.value)}
              style={{ marginTop: 8 }}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <button className="primary" disabled={busy || !check?.ok} onClick={() => void send()}>
                Send reply
              </button>
              {check && !check.ok && <span className="small muted">{check.error}</span>}
            </div>
          </>
        )}

      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
