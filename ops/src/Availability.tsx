// Availability requests: "check what is free at Empire City" (SPEC §11,
// PLAN-v3 S7.1).
//
// A sourcing job with a 24-hour clock from the renter's WhatsApp code. The
// brief shows what fits on file (advertised - an agent still has to say it is
// free) and the building's agents; each step is one typed action, and the
// state is derived from the log with the shared reducer (invariants 1, 2).
// The renter's name and number never reach this screen (invariant 4): the
// functions behind it do not return them.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import {
  AGENT_ANSWERS, INQUIRY_CLOSE_REASONS, inquiryDeadline, reduceInquiry,
  type InquiryEvent, type InquiryView, type AgentAnswer,
} from '../../supabase/functions/_shared/viewing-domain';
import { describeInquiry } from '../../supabase/functions/_shared/viewing/inquiry';
import { formatVnd, humanAge } from '../../supabase/functions/_shared/viewing/format';

interface Row {
  id: string;
  complex_id: string;
  complex_name: string;
  district: string | null;
  bedrooms: number;
  budget_max_vnd: number | null;
  move_in: string;
  lease_months: number;
  has_pets: boolean;
  created_at: string;
  confirmed_at: string | null;
  last_renter_at: string | null;
  last_ours_at: string | null;
  events: InquiryEvent[];
}

interface Detail {
  id: string;
  complex: { id: string; name: string; slug: string | null; district: string | null; management_company: string | null };
  bedrooms: number;
  budget_max_vnd: number | null;
  move_in: string;
  lease_months: number;
  has_pets: boolean;
  notes: string | null;
  confirmed_at: string | null;
  window_expires_at: string | null;
  opted_out: boolean;
  consecutive_outbound: number;
  thread: { id: string; direction: 'inbound' | 'outbound'; source: string; body: string; created_at: string }[];
  events: InquiryEvent[];
  on_file: {
    id: string; title: string; price_vnd: number; bedrooms: number; area_sqm: number; source: string;
    source_url: string; listed_at: string; realtor_id: string | null; realtor_name: string | null; realtor_phone: string | null;
  }[];
}

interface RosterAgent { realtor_id: string; name: string | null; phone: string; sources: string[]; listings_total: number }

const ANSWER_LABEL: Record<AgentAnswer, string> = { HAS_UNITS: 'has units', NO_UNITS: 'no units', NO_REPLY: 'no reply' };

const summary = (r: { bedrooms: number; budget_max_vnd: number | null; move_in: string; lease_months: number; has_pets: boolean }) =>
  describeInquiry({
    fullName: '', complexName: '', bedrooms: r.bedrooms, budgetMaxVnd: r.budget_max_vnd,
    moveInDate: r.move_in, leaseMonths: r.lease_months, hasPets: r.has_pets,
  });

const hcmc = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '-';

/** Time left to the 24-hour promise, as the queue shows it. */
function clock(view: InquiryView): { text: string; cls: string } {
  const due = inquiryDeadline(view);
  if (!due || view.state === 'CLOSED') return { text: '-', cls: 'muted' };
  const left = (Date.parse(due) - Date.now()) / 1000;
  if (left <= 0) return { text: `${humanAge(-left)} over`, cls: 'age-late' };
  return { text: `${humanAge(left)} left`, cls: left < 8 * 3600 ? 'age-warn' : 'age-ok' };
}

async function act(body: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('ops-record-outcome', { body });
  const payload = data as { error?: string; message?: string } | null;
  if (error || payload?.error) {
    const detail = await (error as { context?: Response } | null)?.context?.json().catch(() => null);
    return detail?.message ?? payload?.message ?? payload?.error ?? error?.message ?? 'Failed';
  }
  return null;
}

export function Availability() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('ops_inquiries');
    if (err) { setError(err.message); return; }
    setRows((data ?? []) as Row[]);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  if (openId) return <InquiryDetail inquiryId={openId} onBack={() => { setOpenId(null); void load(); }} />;
  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading...</p>;

  const decorated = rows.map(r => ({ r, v: reduceInquiry(r.id, r.events) }));
  // Work is what has a code and is open. A form nobody sent from WhatsApp, or a
  // closed request, is history.
  const visible = showAll ? decorated : decorated.filter(d => d.v.state === 'NEW' || d.v.state === 'SOURCING');
  visible.sort((a, b) => (inquiryDeadline(a.v) ?? '9').localeCompare(inquiryDeadline(b.v) ?? '9'));

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Availability requests</h2>
        <div className="spacer" />
        <label className="small muted">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> show closed and unsent
        </label>
        <button onClick={() => void load()}>Refresh</button>
      </div>
      {visible.length === 0 && <p className="muted">Nothing waiting.</p>}
      {visible.length > 0 && (
        <table>
          <thead>
            <tr><th>Building</th><th>What they need</th><th>State</th><th>Reply due</th><th>Agents asked</th><th>Renter</th></tr>
          </thead>
          <tbody>
            {visible.map(({ r, v }) => {
              const c = clock(v);
              const asked = Object.values(v.agents).filter(a => a.askedAt).length;
              const answered = Object.values(v.agents).filter(a => a.answer === 'HAS_UNITS').length;
              const waiting = !!r.last_renter_at && (!r.last_ours_at || r.last_renter_at > r.last_ours_at);
              return (
                <tr key={r.id} onClick={() => setOpenId(r.id)}>
                  <td><strong>{r.complex_name}</strong> <span className="small muted">{r.district ?? ''}</span></td>
                  <td className="small">{summary(r)}</td>
                  <td className="small">{v.state}{v.closedReason ? ` · ${v.closedReason}` : ''}</td>
                  <td className={c.cls}>{c.text}</td>
                  <td>{asked}{answered > 0 && <span className="tag good"> {answered} with units</span>}</td>
                  <td>{waiting && v.state !== 'CLOSED' ? <span className="tag warn">waiting on us</span> : <span className="muted small">-</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function InquiryDetail({ inquiryId, onBack }: { inquiryId: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string>('NOTHING_FOUND');
  const [closeNote, setCloseNote] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('ops_inquiry_detail', { _inquiry_id: inquiryId });
    if (err) { setError(err.message); return; }
    const detail = data as Detail | null;
    setD(detail);
    if (detail) {
      const { data: roster } = await supabase.rpc('ops_building_roster');
      const building = ((roster ?? []) as { id: string; agents: RosterAgent[] }[]).find(b => b.id === detail.complex.id);
      setAgents(building?.agents ?? []);
    }
  }, [inquiryId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const err = await act({ inquiryId, ...body });
    setBusy(false);
    if (err) { setError(err); return; }
    after?.();
    void load();
  };

  if (!d) return <p className="muted">{error ?? 'Loading...'}</p>;

  const v = reduceInquiry(d.id, d.events);
  const c = clock(v);
  const windowOpen = !!d.window_expires_at && Date.parse(d.window_expires_at) > Date.now();
  const canReply = v.state !== 'CLOSED' && windowOpen && !d.opted_out && d.consecutive_outbound < 2;
  const replyBlocked = v.state === 'CLOSED' ? 'Closed - reopen to reply.'
    : d.opted_out ? 'They said STOP.'
    : !windowOpen ? 'Their WhatsApp window has closed. It reopens when they write to us.'
    : d.consecutive_outbound >= 2 ? 'Two messages without an answer - wait for them.'
    : null;
  // Agents on file who are not on the roster yet (it has every listing agent, so rarely).
  const known = new Set(agents.map(a => a.realtor_id));
  const extra = d.on_file.filter(l => l.realtor_id && !known.has(l.realtor_id))
    .map(l => ({ realtor_id: l.realtor_id!, name: l.realtor_name, phone: l.realtor_phone ?? '', sources: ['LISTING'], listings_total: 0 }));

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button onClick={onBack}>Back</button>
        <h2 style={{ fontSize: 15, margin: 0 }}>{d.complex.name}</h2>
        <span className="small muted">{d.complex.district ?? ''}{d.complex.management_company ? ` · ${d.complex.management_company}` : ''}</span>
        <div className="spacer" />
        <span className="tag">{v.state}{v.closedReason ? ` · ${v.closedReason}` : ''}</span>
        <span className={c.cls}>{c.text}</span>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <strong>What they need</strong>
        <p style={{ margin: '4px 0' }}>{summary(d)}</p>
        {d.notes && <p className="small muted" style={{ margin: 0 }}>“{d.notes}”</p>}
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Code arrived {hcmc(d.confirmed_at)} · reply promised by {hcmc(inquiryDeadline(v))} · window {windowOpen ? `open until ${hcmc(d.window_expires_at)}` : 'closed'}
        </p>
      </div>

      <div className="card">
        <strong>On file that fits</strong> <span className="small muted">- advertised, not confirmed: ask the agent</span>
        {d.on_file.length === 0 && <p className="small muted">Nothing advertised at this building fits.</p>}
        {d.on_file.length > 0 && (
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Listing</th><th>Price</th><th>Size</th><th>Agent</th><th>Listed</th></tr></thead>
            <tbody>
              {d.on_file.map(l => (
                <tr key={l.id}>
                  <td className="small"><a href={l.source_url} target="_blank" rel="noreferrer">{l.title}</a></td>
                  <td className="small">{formatVnd(l.price_vnd)}</td>
                  <td className="small">{l.bedrooms}BR · {l.area_sqm}m²</td>
                  <td className="small">{l.realtor_name ?? <span className="muted">no agent on file</span>}</td>
                  <td className="small">{hcmc(l.listed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <strong>Agents for this building</strong>
        <span className="small muted"> - ask by hand on Zalo or by phone, then record it. Add agents on the Buildings screen.</span>
        {agents.length + extra.length === 0 && <p className="small muted">Nobody on file for this building yet.</p>}
        {agents.length + extra.length > 0 && (
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Agent</th><th>Phone</th><th>Asked</th><th>Answer</th><th /></tr></thead>
            <tbody>
              {[...agents, ...extra].map(a => {
                const s = v.agents[a.realtor_id];
                return (
                  <tr key={a.realtor_id}>
                    <td className="small">{a.name ?? 'no name'}{a.listings_total >= 30 && <span className="tag warn"> agency desk</span>}</td>
                    <td className="small">{a.phone}</td>
                    <td className="small">{s?.askedAt ? `${hcmc(s.askedAt)}${s.medium ? ` · ${s.medium}` : ''}` : '-'}</td>
                    <td className="small">{s?.answer ? ANSWER_LABEL[s.answer] : '-'}</td>
                    <td className="row">
                      {!s?.askedAt && (
                        <>
                          <button disabled={busy} onClick={() => void run({ action: 'INQUIRY_ASK_AGENT', realtorId: a.realtor_id, medium: 'ZALO' })}>Asked on Zalo</button>
                          <button disabled={busy} onClick={() => void run({ action: 'INQUIRY_ASK_AGENT', realtorId: a.realtor_id, medium: 'PHONE' })}>by phone</button>
                        </>
                      )}
                      {s?.askedAt && AGENT_ANSWERS.map(ans => (
                        <button key={ans} disabled={busy || s.answer === ans}
                          onClick={() => void run({ action: 'INQUIRY_AGENT_ANSWERED', realtorId: a.realtor_id, answer: ans })}>
                          {ANSWER_LABEL[ans]}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <strong>WhatsApp</strong>
        <div className="thread" style={{ marginTop: 6 }}>
          {d.thread.map(m => (
            <div key={m.id} className="bubble" style={{ marginLeft: m.direction === 'outbound' ? 40 : 0 }}>
              <div className="small muted">{m.direction === 'inbound' ? 'Renter' : m.source === 'system' ? 'Hausto (automatic)' : 'Hausto'} · {hcmc(m.created_at)}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            </div>
          ))}
        </div>
        <textarea rows={4} value={draft} disabled={!canReply} onChange={e => setDraft(e.target.value)}
          placeholder={replyBlocked ?? 'One message with everything reads best - the units, their prices, a question to answer.'} />
        <div className="row" style={{ marginTop: 6 }}>
          <span className="small muted">{replyBlocked ?? `${2 - d.consecutive_outbound} message(s) before they must reply`}</span>
          <div className="spacer" />
          <button disabled={busy || !canReply || !draft.trim()}
            onClick={() => void run({ action: 'INQUIRY_REPLY', body: draft, key: crypto.randomUUID() }, () => setDraft(''))}>
            Send on WhatsApp
          </button>
        </div>
      </div>

      <div className="card">
        {v.state === 'CLOSED' ? (
          <div className="row">
            <span>Closed {hcmc(v.closedAt)} · {v.closedReason}</span>
            <div className="spacer" />
            <button disabled={busy} onClick={() => void run({ action: 'INQUIRY_REOPEN' })}>Reopen</button>
          </div>
        ) : (
          <div className="row wrap-row">
            <strong>Close</strong>
            <select value={reason} onChange={e => setReason(e.target.value)}>
              {INQUIRY_CLOSE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <input style={{ flex: 1 }} placeholder="Note (optional, never parsed)" value={closeNote} onChange={e => setCloseNote(e.target.value)} />
            <button disabled={busy} onClick={() => void run({ action: 'INQUIRY_CLOSE', reason, note: closeNote }, () => setCloseNote(''))}>Close</button>
          </div>
        )}
      </div>

      <div className="card">
        <strong>Log</strong>
        {d.events.map(e => (
          <div key={e.id} className="small">
            {hcmc(e.occurred_at)} · {e.type}
            {e.payload && Object.keys(e.payload).length > 0 && <span className="muted"> {JSON.stringify(e.payload)}</span>}
            <span className="muted"> · {e.actor}</span>
          </div>
        ))}
      </div>
    </>
  );
}
