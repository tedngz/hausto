// /dev/phone - a fake WhatsApp thread (SPEC §5).
//
// Not a preview of the messages, a stand-in for the channel. Everything through
// S6 has to be demoable here, because Meta Business verification, number
// provisioning and template approval are human-blocked and none of them will be
// done. `MockAdapter` writes the same `messages` rows `CloudApiAdapter` does, so
// what this renders is the real thread minus the transport.
//
// It also shows the two facts that decide whether the next send is legal: the
// 24-hour service window, and the consecutive-outbound count. A mock phone that
// hid those would let you demo a flow that throws in production.

import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';

interface ThreadMessage {
  id: string;
  request_id: string | null;
  direction: 'IN' | 'OUT';
  body: string | null;
  template_name: string | null;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

interface Thread {
  renter: {
    id: string;
    phone_e164: string;
    display_name: string | null;
    service_window_expires_at: string | null;
    opted_out_at: string | null;
  } | null;
  messages: ThreadMessage[];
  windowOpen: boolean;
  consecutiveOutbound: number;
  mode: string;
}

const STORED_PHONE_KEY = 'hausto.devphone.phone';

/** Asia/Ho_Chi_Minh, per SPEC §7. Stored UTC, displayed local - always. */
const timeInHcmc = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

export default function DevPhone() {
  const [phone, setPhone] = useState(() => localStorage.getItem(STORED_PHONE_KEY) ?? '');
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useMemo(() => async (forPhone: string) => {
    if (!forPhone.trim()) { setThread(null); return; }
    setError(null);
    // A body with no `text` is a read. Same verb as a simulated send, so both
    // go through `functions.invoke` rather than one of them being a hand-rolled
    // fetch with the anon key pasted in.
    const { data, error: err } = await supabase.functions.invoke('dev-phone', {
      body: { phone: forPhone },
    });
    if (err) { setError(err.message); return; }
    if ((data as { error?: string })?.error) { setError((data as { message?: string }).message ?? (data as { error: string }).error); return; }
    setThread(data as Thread);
  }, []);

  // Polled rather than subscribed. A dev surface refreshing every three seconds
  // is cheaper to reason about than a realtime channel, and nothing here is
  // latency-sensitive.
  useEffect(() => {
    if (!phone.trim()) return;
    void load(phone);
    const t = setInterval(() => void load(phone), 3000);
    return () => clearInterval(t);
  }, [phone, load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('dev-phone', {
      body: { phone, text },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    const payload = data as { error?: string; message?: string; thread?: Thread };
    if (payload?.error) { setError(payload.message ?? payload.error); return; }
    setDraft('');
    if (payload?.thread) setThread(payload.thread);
  };

  const savePhone = (value: string) => {
    setPhone(value);
    localStorage.setItem(STORED_PHONE_KEY, value);
  };

  return (
    <div className="min-h-screen bg-neutral-100 py-8">
      <Helmet>
        <title>Mock phone - Hausto dev</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="mx-auto w-full max-w-md px-4">
        <h1 className="mb-1 text-lg font-semibold">Mock phone</h1>
        <p className="mb-4 text-xs text-neutral-500">
          The thread as the renter sees it. Outbound rows are written by the send
          service before anything is delivered, so a QUEUED or FAILED row here is
          the real thing, not a rendering artefact.
        </p>

        <input
          className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="Renter phone, e.g. 0901234567"
          value={phone}
          onChange={e => savePhone(e.target.value)}
        />

        {error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        {thread && (
          <>
            <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
              <Pill
                tone={thread.windowOpen ? 'good' : 'bad'}
                label={thread.windowOpen ? 'Window open' : 'Window closed'}
                detail={
                  thread.renter?.service_window_expires_at
                    ? `until ${timeInHcmc(thread.renter.service_window_expires_at)}`
                    : 'never opened - only a template can open it'
                }
              />
              <Pill
                tone={thread.consecutiveOutbound >= 2 ? 'bad' : 'neutral'}
                label={`${thread.consecutiveOutbound} in a row`}
                detail={thread.consecutiveOutbound >= 2 ? 'a third would be refused' : 'outbound since last inbound'}
              />
              {thread.renter?.opted_out_at && <Pill tone="bad" label="Opted out" detail="" />}
              <Pill tone="neutral" label={`mode: ${thread.mode}`} detail="" />
            </div>

            <div className="mb-3 h-[28rem] space-y-2 overflow-y-auto rounded-lg bg-[#e5ddd5] p-3">
              {thread.messages.length === 0 && (
                <p className="pt-8 text-center text-xs text-neutral-600">
                  Nothing yet. Send the deep-link text from a request to start the thread.
                </p>
              )}
              {thread.messages.map(m => <Bubble key={m.id} message={m} />)}
            </div>
          </>
        )}

        <div className="flex gap-2">
          <input
            className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-sm"
            placeholder="Type as the renter..."
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void send(); }}
          />
          <button
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void send()}
            disabled={busy || !draft.trim() || !phone.trim()}
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          Sending here takes the same path Meta's delivery does - it re-opens the
          service window and writes a RENTER_REPLIED event. That is why it is
          refused outright when WHATSAPP_MODE is cloud.
        </p>
      </div>
    </div>
  );
}

function Pill({ tone, label, detail }: { tone: 'good' | 'bad' | 'neutral'; label: string; detail: string }) {
  const colour = tone === 'good'
    ? 'bg-emerald-100 text-emerald-800'
    : tone === 'bad'
      ? 'bg-red-100 text-red-800'
      : 'bg-neutral-200 text-neutral-700';
  return (
    <span className={`rounded px-2 py-1 ${colour}`} title={detail}>
      {label}{detail ? ` - ${detail}` : ''}
    </span>
  );
}

function Bubble({ message }: { message: ThreadMessage }) {
  const inbound = message.direction === 'IN';
  return (
    <div className={`flex ${inbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${inbound ? 'bg-[#dcf8c6]' : 'bg-white'}`}>
        {message.template_name && (
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            template: {message.template_name}
          </div>
        )}
        <div className="whitespace-pre-wrap">{message.body ?? <em className="text-neutral-500">no body</em>}</div>
        <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-neutral-500">
          <span>{timeInHcmc(message.created_at)}</span>
          {!inbound && (
            <span className={message.status === 'FAILED' ? 'text-red-600' : ''}>{message.status}</span>
          )}
        </div>
        {message.error && <div className="mt-1 text-[10px] text-red-600">{message.error}</div>}
      </div>
    </div>
  );
}
