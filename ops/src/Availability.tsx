// Availability requests: "check what is free at Empire City" (SPEC §11,
// PLAN-v3 S7.1) - and Priority search, the same job for an area.
//
// A sourcing job with a 24-hour clock from the renter's WhatsApp code (48 for
// an area). The brief shows what fits on file (advertised - an agent still has
// to say it is free) and the agents to ask; each step is one typed action, and
// the state is derived from the log with the shared reducer (invariants 1, 2).
// The renter's name and number never reach this screen (invariant 4): the
// functions behind it do not return them.
//
// An area request has no building: its agents are the ones listing in its
// districts, each unit is entered with where it is, and only units an agent
// has confirmed can be offered - Priority search promises that.

import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeFailure } from './supabase';
import {
  AGENT_ANSWERS, INQUIRY_CLOSE_REASONS, inquiryDeadline, reduceInquiry,
  type InquiryEvent, type InquiryView, type AgentAnswer,
} from '../../supabase/functions/_shared/viewing-domain';
import { describeInquiry } from '../../supabase/functions/_shared/viewing/inquiry';
import { availabilityDraft } from '../../supabase/functions/_shared/realtor/drafts';
import { areaLabelVi, districtLabel } from '../../supabase/functions/_shared/viewing/place';
import type { SuggestedUnit, UnitSuggestion } from '../../supabase/functions/_shared/viewing/unit-parse';
import { formatVnd, humanAge } from '../../supabase/functions/_shared/viewing/format';
import {
  FURNISHING, MAX_COMBINED_UNITS, MAX_OFFER_UNITS, MAX_PHOTOS, UNIT_FRESH_DAYS, briefOf, misfit, priceCeiling,
  renderOfferSections, unitStale, type Brief, type OfferSection, type OfferUnit,
} from '../../supabase/functions/_shared/viewing/offer';

interface Row {
  id: string;
  /** Null for an area (Priority search); `complex_name` is then its label. */
  complex_id: string | null;
  complex_name: string;
  district: string | null;
  area_district_codes: string[] | null;
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
  /** For an area, the area in this shape: its label, and no id. */
  complex: { id: string | null; name: string; slug: string | null; district: string | null; management_company: string | null };
  /** Priority search: the districts searched. Null for a building. */
  area_district_codes: string[] | null;
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
  units: CapturedUnit[];
  /** The same renter's other recent requests - ids and buildings only. */
  siblings?: { id: string; complex_name: string }[];
  on_file: {
    id: string; title: string; price_vnd: number; bedrooms: number; area_sqm: number; source: string;
    source_url: string; district_code: string | null; listed_at: string;
    realtor_id: string | null; realtor_name: string | null; realtor_phone: string | null;
  }[];
}

interface RosterAgent { realtor_id: string; name: string | null; phone: string; sources: string[]; listings_total: number }

interface CapturedUnit {
  id: string; title: string; price_vnd: number; bedrooms: number; area_sqm: number; images: string[] | null;
  is_active: boolean; last_verified_at: string | null; realtor_id: string | null; realtor_name: string | null;
}

const ANSWER_LABEL: Record<AgentAnswer, string> = { HAS_UNITS: 'has units', NO_UNITS: 'no units', NO_REPLY: 'no reply' };

const summary = (r: { bedrooms: number; budget_max_vnd: number | null; move_in: string; lease_months: number; has_pets: boolean }) =>
  describeInquiry({
    fullName: '', complexName: '', bedrooms: r.bedrooms, budgetMaxVnd: r.budget_max_vnd,
    moveInDate: r.move_in, leaseMonths: r.lease_months, hasPets: r.has_pets,
  });

const hcmc = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '-';

/** Time left to the promise (24 hours, 48 for an area), as the queue shows it. */
function clock(view: InquiryView): { text: string; cls: string } {
  const due = inquiryDeadline(view);
  if (!due || view.state === 'CLOSED') return { text: '-', cls: 'muted' };
  const left = (Date.parse(due) - Date.now()) / 1000;
  if (left <= 0) return { text: `${humanAge(-left)} over`, cls: 'age-late' };
  return { text: `${humanAge(left)} left`, cls: left < 8 * 3600 ? 'age-warn' : 'age-ok' };
}

async function act(body: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('ops-record-outcome', { body });
  return invokeFailure(data, error);
}

/**
 * The list, or one request when `openId` is set. The shell owns which one is
 * open, so a link (`#/inquiry/<id>`, from the Inbox or the digest email) lands
 * on it and the browser's back button leaves it.
 */
export function Availability({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setOpenId = onOpen;
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
            <tr><th>Building or area</th><th>What they need</th><th>State</th><th>Reply due</th><th>Agents asked</th><th>Renter</th></tr>
          </thead>
          <tbody>
            {visible.map(({ r, v }) => {
              const c = clock(v);
              const asked = Object.values(v.agents).filter(a => a.askedAt).length;
              const answered = Object.values(v.agents).filter(a => a.answer === 'HAS_UNITS').length;
              const waiting = !!r.last_renter_at && (!r.last_ours_at || r.last_renter_at > r.last_ours_at);
              return (
                <tr key={r.id} onClick={() => setOpenId(r.id)}>
                  <td>
                    <strong>{r.complex_name}</strong>{' '}
                    {r.area_district_codes ? <span className="tag">Priority search</span> : <span className="small muted">{r.district ?? ''}</span>}
                  </td>
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
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  // Which way messages to agents leave, from what the planner last saw - the
  // console cannot read secrets (as RequestDetail reads it).
  const [bridge, setBridge] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  // An agent met in a group while searching, not on file yet: asked by number.
  const [newAgent, setNewAgent] = useState({ phone: '', name: '' });
  // Agents already on this request who are on no roster - mostly a search's,
  // found in groups - so they stay listed once asked.
  const [onRequest, setOnRequest] = useState<RosterAgent[]>([]);
  // What an agent's reply is adding to the capture form (S7.2b).
  const [incoming, setIncoming] = useState<UnitIncoming | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('ops_inquiry_detail', { _inquiry_id: inquiryId });
    if (err) { setError(err.message); return; }
    const detail = data as Detail | null;
    setD(detail);
    const [{ data: rm }, { data: controls }] = await Promise.all([
      supabase.from('realtor_messages').select('id, realtor_id, direction, purpose, body, status, error, created_at, attachments')
        .eq('inquiry_id', inquiryId).order('created_at', { ascending: true }),
      supabase.from('ai_operator_controls').select('last_state').eq('id', 'singleton').maybeSingle(),
    ]);
    setAgentMessages((rm ?? []) as AgentMessage[]);
    setBridge((controls?.last_state as { realtorChannel?: string } | null)?.realtorChannel === 'bridge');
    const involved = [...new Set([
      ...(detail?.events ?? []).map(e => (e.payload as { realtor_id?: string } | null)?.realtor_id),
      ...(detail?.units ?? []).map(u => u.realtor_id),
      ...((rm ?? []) as AgentMessage[]).map(m => m.realtor_id),
    ].filter((id): id is string => !!id))];
    const { data: people } = involved.length
      ? await supabase.from('realtors').select('id, display_name, phone_e164').in('id', involved)
      : { data: [] };
    setOnRequest(((people ?? []) as { id: string; display_name: string | null; phone_e164: string }[]).map(p => ({
      realtor_id: p.id, name: p.display_name, phone: p.phone_e164, sources: ['REQUEST'], listings_total: 0,
    })));
    if (detail?.complex.id) {
      const { data: roster } = await supabase.rpc('ops_building_roster');
      const building = ((roster ?? []) as { id: string; agents: RosterAgent[] }[]).find(b => b.id === detail.complex.id);
      setAgents(building?.agents ?? []);
    } else if (detail?.area_district_codes) {
      // An area's agents: those listing in its districts, who answer us first.
      const { data: roster } = await supabase.rpc('ops_area_roster', { _district_codes: detail.area_district_codes });
      setAgents((roster ?? []) as RosterAgent[]);
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
  // Agents on file who are not on the roster yet (it has every listing agent,
  // so rarely), then agents on this request who are on no roster at all.
  const known = new Set(agents.map(a => a.realtor_id));
  const extra: RosterAgent[] = [];
  for (const a of [
    ...d.on_file.filter(l => l.realtor_id).map(l => ({
      realtor_id: l.realtor_id!, name: l.realtor_name, phone: l.realtor_phone ?? '', sources: ['LISTING'], listings_total: 0,
    })),
    ...onRequest,
  ]) {
    if (known.has(a.realtor_id)) continue;
    known.add(a.realtor_id);
    extra.push(a);
  }
  const everyone = [...agents, ...extra];
  const area = d.area_district_codes;
  const here = area ? 'in these districts' : 'at this building';
  const ask = (who: Record<string, unknown>, medium: 'ZALO' | 'PHONE', message?: string) => void run(
    { action: 'INQUIRY_ASK_AGENT', ...who, medium, ...(message ? { message } : {}) },
    () => { setAsking(null); if (!('realtorId' in who)) setNewAgent({ phone: '', name: '' }); },
  );

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button onClick={onBack}>Back</button>
        <h2 style={{ fontSize: 15, margin: 0 }}>{d.complex.name}</h2>
        {area
          ? <span className="tag">Priority search</span>
          : <span className="small muted">{d.complex.district ?? ''}{d.complex.management_company ? ` · ${d.complex.management_company}` : ''}</span>}
        <div className="spacer" />
        <span className="tag">{v.state}{v.closedReason ? ` · ${v.closedReason}` : ''}</span>
        <span className={c.cls}>{c.text}</span>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <strong>What they need</strong>
        <p style={{ margin: '4px 0' }}>{summary(d)}</p>
        <BriefLine d={d} v={v} closed={v.state === 'CLOSED'} busy={busy} run={run} />
        {d.notes && <p className="small muted" style={{ margin: 0 }}>“{d.notes}”</p>}
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Code arrived {hcmc(d.confirmed_at)} · reply promised by {hcmc(inquiryDeadline(v))} · window {windowOpen ? `open until ${hcmc(d.window_expires_at)}` : 'closed'}
        </p>
      </div>

      <div className="card">
        <strong>On file that fits</strong>
        <span className="small muted">
          {area
            ? ' - advertised, so leads only: ask the agent, and add what they confirm as a unit. Only confirmed units can be offered for a search.'
            : ' - advertised, not confirmed: ask the agent'}
        </span>
        {d.on_file.length === 0 && <p className="small muted">Nothing advertised {here} fits.</p>}
        {d.on_file.length > 0 && (
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Listing</th><th>Price</th><th>Size</th>{area && <th>District</th>}<th>Agent</th><th>Listed</th>{area && <th />}</tr></thead>
            <tbody>
              {d.on_file.map(l => (
                <tr key={l.id}>
                  <td className="small"><a href={l.source_url} target="_blank" rel="noreferrer">{l.title}</a></td>
                  <td className="small">{formatVnd(l.price_vnd)}</td>
                  <td className="small">{l.bedrooms}BR · {l.area_sqm}m²</td>
                  {area && <td className="small">{l.district_code ? districtLabel(l.district_code) : '-'}</td>}
                  <td className="small">{l.realtor_name ?? <span className="muted">no agent on file</span>}</td>
                  <td className="small">{hcmc(l.listed_at)}</td>
                  {area && (
                    <td>
                      {v.state !== 'CLOSED' && (
                        <button className="link small" disabled={busy} title="Once its agent has confirmed it is free"
                          onClick={() => setIncoming({
                            key: Date.now(), realtorId: l.realtor_id, districtCode: l.district_code,
                            unit: {
                              bedrooms: l.bedrooms, areaSqm: l.area_sqm, priceVnd: l.price_vnd, floor: null, tower: null,
                              furnishing: null, petsOk: null, availableFrom: null, quote: l.title, problems: [],
                            },
                          })}>
                          confirmed - fill the form
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <strong>{area ? 'Agents for this search' : 'Agents for this building'}</strong>
        <span className="small muted">
          {area
            ? ' - those listing in these districts, who answer us first at the top, and anyone you have asked. Ask on Zalo or by phone, then record it.'
            : ' - ask by hand on Zalo or by phone, then record it. Add agents on the Buildings screen.'}
        </span>
        {everyone.length === 0 && <p className="small muted">Nobody on file {here} yet.</p>}
        {everyone.length > 0 && (
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Agent</th><th>Phone</th><th>Asked</th><th>Answer</th><th /></tr></thead>
            <tbody>
              {everyone.map(a => {
                const s = v.agents[a.realtor_id];
                const lastOut = [...agentMessages].reverse().find(m => m.realtor_id === a.realtor_id && m.direction === 'OUT');
                return (
                  <tr key={a.realtor_id}>
                    <td className="small">{a.name ?? 'no name'}{a.listings_total >= 30 && <span className="tag warn"> agency desk</span>}</td>
                    <td className="small">{a.phone}</td>
                    <td className="small">{s?.askedAt ? `${hcmc(s.askedAt)}${s.medium ? ` · ${s.medium}` : ''}` : '-'}</td>
                    <td className="small">{s?.answer ? ANSWER_LABEL[s.answer] : '-'}</td>
                    <td className="row">
                      {lastOut?.status === 'QUEUED' && <span className="tag">queued for the Zalo device</span>}
                      {lastOut?.status === 'FAILED' && <span className="tag warn" title={lastOut.error ?? ''}>not sent</span>}
                      {(!s?.askedAt || lastOut?.status === 'FAILED') && (
                        <>
                          <button disabled={busy} onClick={() => setAsking(a.realtor_id)}>Ask on Zalo</button>
                          {!s?.askedAt && (
                            <button disabled={busy} onClick={() => ask({ realtorId: a.realtor_id }, 'PHONE')}>asked by phone</button>
                          )}
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
        {/* A search's agents are mostly met in Facebook and Zalo groups, not on
            file: recorded by their number, they are added and stay listed above.
            They are reached from the sourcing accounts, not the bridge's, so
            this records the ask rather than sending one. */}
        {area && v.state !== 'CLOSED' && (
          <div className="row wrap-row" style={{ marginTop: 6 }}>
            <span className="small muted">Asked someone from a group:</span>
            <input style={{ width: 140 }} placeholder="Their number" value={newAgent.phone}
              onChange={e => setNewAgent(n => ({ ...n, phone: e.target.value }))} />
            <input style={{ width: 160 }} placeholder="Name (optional)" value={newAgent.name}
              onChange={e => setNewAgent(n => ({ ...n, name: e.target.value }))} />
            <button disabled={busy || !newAgent.phone.trim()}
              onClick={() => ask({ agentPhone: newAgent.phone, agentName: newAgent.name }, 'ZALO')}>asked on Zalo</button>
            <button disabled={busy || !newAgent.phone.trim()}
              onClick={() => ask({ agentPhone: newAgent.phone, agentName: newAgent.name }, 'PHONE')}>asked by phone</button>
          </div>
        )}
        {asking && (
          <AskBox
            key={asking}
            agentName={everyone.find(a => a.realtor_id === asking)?.name ?? 'the agent'}
            initial={availabilityDraft({
              // An area reads "khu vực Quận 2 và Binh Thanh" to an agent.
              complexName: area ? `khu vực ${areaLabelVi(area)}` : d.complex.name,
              bedrooms: d.bedrooms, budgetMaxVnd: d.budget_max_vnd,
              moveInDate: d.move_in, leaseMonths: d.lease_months, hasPets: d.has_pets,
            })}
            bridge={bridge}
            busy={busy}
            onSend={text => ask({ realtorId: asking }, 'ZALO', text)}
            onCancel={() => setAsking(null)}
          />
        )}
        <AgentConversations
          messages={agentMessages}
          nameOf={id => everyone.find(a => a.realtor_id === id)?.name ?? 'Agent'}
          inquiryId={inquiryId}
          busy={busy || v.state === 'CLOSED'}
          onUse={x => setIncoming({ ...x, key: Date.now() })}
        />
      </div>

      <Units d={d} agents={everyone} closed={v.state === 'CLOSED'} busy={busy} run={run} inquiryId={inquiryId}
        incoming={incoming} />

      <OfferComposer d={d} canReply={canReply} replyBlocked={replyBlocked} busy={busy} run={run} />

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
        {/* After the window: the request_update template carries no news, only
            "reply here to see it" - their reply reopens the window. Refused
            until Meta approves the template (docs/whatsapp-go-live.md). */}
        {!windowOpen && v.state !== 'CLOSED' && !!d.confirmed_at && !d.opted_out && (
          <div className="row" style={{ marginTop: 6 }}>
            <span className="small muted">
              Have news for them? Send "we have an update on your request - reply here to see it", and their reply reopens the window.
            </span>
            <div className="spacer" />
            <button disabled={busy} onClick={() => void run({ action: 'INQUIRY_SEND_UPDATE', key: crypto.randomUUID() })}>
              Send update template
            </button>
          </div>
        )}
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

type Run = (body: Record<string, unknown>, after?: () => void) => Promise<void>;

/**
 * Units an agent offered, entered as listings (S7.1b). Photos go straight to
 * storage from here - under concierge/<request>/, the only path the upload
 * policy allows - and the action takes their URLs.
 *
 * A search's unit also says where it is - the building or street, and which
 * of the search's districts - and its agent may be one met in a group, entered
 * by number.
 */
function Units({ d, agents, closed, busy, run, inquiryId, incoming }: {
  d: Detail; agents: RosterAgent[]; closed: boolean; busy: boolean; run: Run; inquiryId: string;
  incoming: UnitIncoming | null;
}) {
  const districts = d.area_district_codes;
  const [realtorId, setRealtorId] = useState('');
  const [agentPhone, setAgentPhone] = useState('');
  const [agentName, setAgentName] = useState('');
  const [building, setBuilding] = useState('');
  const [districtCode, setDistrictCode] = useState(districts?.length === 1 ? districts[0] : '');
  const [bedrooms, setBedrooms] = useState('2');
  const [area, setArea] = useState('');
  const [priceM, setPriceM] = useState('');
  const [floor, setFloor] = useState('');
  const [tower, setTower] = useState('');
  const [furnishing, setFurnishing] = useState('');
  const [pets, setPets] = useState('');
  const [availableFrom, setAvailableFrom] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // A suggested unit, or an agent's photos, from the conversation above. Fills
  // the form; nothing is added until the operator presses Add unit.
  useEffect(() => {
    if (!incoming) return;
    if (incoming.realtorId) setRealtorId(incoming.realtorId);
    if (incoming.districtCode) setDistrictCode(incoming.districtCode);
    const u = incoming.unit;
    if (u) {
      if (u.bedrooms) setBedrooms(String(Math.min(u.bedrooms, 4)));
      setArea(u.areaSqm ? String(u.areaSqm) : '');
      setPriceM(u.priceVnd ? String(u.priceVnd / 1_000_000) : '');
      setFloor(u.floor ?? '');
      setTower(u.tower ?? '');
      setFurnishing(u.furnishing ?? '');
      setPets(u.petsOk == null ? '' : u.petsOk ? 'yes' : 'no');
      setAvailableFrom(u.availableFrom ?? '');
      setNote(u.quote ? `Agent: "${u.quote}"` : '');
    }
    if (incoming.addPhotos?.length) {
      setPhotos(p => [...new Set([...p, ...incoming.addPhotos!])].slice(0, MAX_PHOTOS));
    }
  }, [incoming]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    const urls: string[] = [];
    for (const file of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `concierge/${inquiryId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('external-property-images').upload(path, file, { contentType: file.type });
      if (error) { setUploadError(error.message); break; }
      urls.push(supabase.storage.from('external-property-images').getPublicUrl(path).data.publicUrl);
    }
    setPhotos(p => [...p, ...urls]);
    setUploading(false);
  };

  const reset = () => {
    setArea(''); setPriceM(''); setFloor(''); setTower(''); setFurnishing(''); setPets('');
    setAvailableFrom(''); setNote(''); setPhotos([]); setBuilding('');
    // A new agent is on file now, and listed above under their name.
    if (realtorId === 'new') { setRealtorId(''); setAgentPhone(''); setAgentName(''); }
  };

  const capture = () => void run({
    action: 'INQUIRY_CAPTURE_UNIT',
    ...(realtorId === 'new' ? { agentPhone, agentName } : { realtorId }),
    ...(districts ? { building, districtCode } : {}),
    bedrooms: Number(bedrooms),
    areaSqm: Number(area),
    priceVnd: Math.round(Number(priceM) * 1_000_000),
    floor, tower, furnishing: furnishing || null,
    petsOk: pets === '' ? null : pets === 'yes',
    availableFrom: availableFrom || null,
    note, photos,
  }, reset);

  return (
    <div className="card">
      <strong>Units agents offered</strong>
      <span className="small muted"> - each becomes a listing the renter can request. It comes down {UNIT_FRESH_DAYS} days after its agent last confirmed it.</span>
      {d.units.length > 0 && (
        <table style={{ marginTop: 6 }}>
          <thead><tr><th>Unit</th><th>Price</th><th>Agent</th><th>Confirmed</th><th>Photos</th><th /></tr></thead>
          <tbody>
            {d.units.map(u => {
              const stale = !u.is_active || unitStale(u.last_verified_at, new Date());
              return (
                <tr key={u.id}>
                  <td className="small"><a href={`https://hausto.com/property/${u.id}`} target="_blank" rel="noreferrer">{u.title}</a></td>
                  <td className="small">{formatVnd(u.price_vnd)}</td>
                  <td className="small">{u.realtor_name ?? '-'}</td>
                  <td className="small">{hcmc(u.last_verified_at)}{stale && <span className="tag bad"> stale</span>}</td>
                  <td className="small">{u.images?.length ?? 0}</td>
                  <td>
                    {!closed && (
                      <button className="link small" disabled={busy}
                        onClick={() => void run({ action: 'INQUIRY_RECONFIRM_UNIT', listingId: u.id })}>still free</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!closed && (
        <div className="proposal">
          <div className="row wrap-row">
            <select value={realtorId} onChange={e => setRealtorId(e.target.value)}>
              <option value="">Agent who offered it</option>
              {agents.map(a => <option key={a.realtor_id} value={a.realtor_id}>{a.name ?? a.phone}</option>)}
              {districts && <option value="new">Someone new, from a group...</option>}
            </select>
            {realtorId === 'new' && (
              <>
                <input style={{ width: 130 }} placeholder="Their Zalo number" value={agentPhone} onChange={e => setAgentPhone(e.target.value)} />
                <input style={{ width: 130 }} placeholder="Name (optional)" value={agentName} onChange={e => setAgentName(e.target.value)} />
              </>
            )}
          </div>
          {districts && (
            <div className="row wrap-row" style={{ marginTop: 6 }}>
              <input style={{ width: 220 }} placeholder="Building or street, e.g. Masteri Thao Dien" value={building}
                onChange={e => setBuilding(e.target.value)} />
              <select value={districtCode} onChange={e => setDistrictCode(e.target.value)}>
                <option value="">Which district?</option>
                {districts.map(code => <option key={code} value={code}>{districtLabel(code)}</option>)}
              </select>
            </div>
          )}
          <div className="row wrap-row" style={{ marginTop: 6 }}>
            <select value={bedrooms} onChange={e => setBedrooms(e.target.value)}>
              {[1, 2, 3, 4].map(b => <option key={b} value={b}>{b === 4 ? '4+' : b} BR</option>)}
            </select>
            <input style={{ width: 90 }} placeholder="m²" inputMode="numeric" value={area} onChange={e => setArea(e.target.value.replace(/\D/g, ''))} />
            <input style={{ width: 130 }} placeholder="Rent, million ₫" inputMode="decimal" value={priceM} onChange={e => setPriceM(e.target.value.replace(/[^0-9.]/g, ''))} />
            <input style={{ width: 80 }} placeholder="Floor" value={floor} onChange={e => setFloor(e.target.value)} />
            <input style={{ width: 120 }} placeholder="Tower" value={tower} onChange={e => setTower(e.target.value)} />
          </div>
          <div className="row wrap-row" style={{ marginTop: 6 }}>
            <select value={furnishing} onChange={e => setFurnishing(e.target.value)}>
              <option value="">Furnishing?</option>
              {FURNISHING.map(f => <option key={f} value={f}>{f.toLowerCase()}</option>)}
            </select>
            <select value={pets} onChange={e => setPets(e.target.value)}>
              <option value="">Pets?</option>
              <option value="yes">pets OK</option>
              <option value="no">no pets</option>
            </select>
            <label className="small muted">Available from <input type="date" value={availableFrom} onChange={e => setAvailableFrom(e.target.value)} /></label>
            <label className="small muted">
              Photos {photos.length > 0 && `(${photos.length})`}
              <input type="file" accept="image/*" multiple disabled={uploading || photos.length >= MAX_PHOTOS}
                onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
            </label>
            {uploading && <span className="small muted">uploading...</span>}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input style={{ flex: 1 }} placeholder="Note for us - what the agent said (never shown to the renter)" value={note} onChange={e => setNote(e.target.value)} />
            <button
              disabled={busy || uploading || !area || !priceM
                || (realtorId === 'new' ? !agentPhone.trim() : !realtorId)
                || (!!districts && !districtCode)}
              onClick={capture}>
              Add unit
            </button>
          </div>
          {uploadError && <p className="error small">{uploadError}</p>}
        </div>
      )}
    </div>
  );
}

/** What one request could offer now, read from its detail. */
interface OfferPart {
  inquiryId: string;
  complexName: string;
  /** A search finds in an area: "in District 2", not "at". */
  place: 'BUILDING' | 'AREA';
  brief: Brief;
  /** Offered before and not answered since: the server refuses another. */
  awaiting: boolean;
  open: boolean;
  candidates: (OfferUnit & { kind: string })[];
}

function offerPart(d: Detail, now: Date): OfferPart {
  const v = reduceInquiry(d.id, d.events);
  return {
    inquiryId: d.id,
    complexName: d.complex.name,
    place: d.area_district_codes ? 'AREA' : 'BUILDING',
    brief: briefOf({ bedrooms: d.bedrooms, budgetMaxVnd: d.budget_max_vnd }, v.brief),
    awaiting: !!v.offeredAt
      && !d.thread.some(m => m.direction === 'inbound' && Date.parse(m.created_at) > Date.parse(v.offeredAt!)),
    open: v.state !== 'CLOSED' && !!d.confirmed_at,
    candidates: [
      ...d.units.filter(u => u.is_active && !unitStale(u.last_verified_at, now)).map(u => ({
        id: u.id, title: u.title, priceVnd: u.price_vnd, bedrooms: u.bedrooms, areaSqm: u.area_sqm,
        confirmedAt: u.last_verified_at, kind: 'confirmed',
      })),
      // A search offers only what an agent confirmed (the server refuses the
      // rest); what is advertised in its districts is a lead, not a candidate.
      ...(d.area_district_codes ? [] : d.on_file).map(l => ({
        id: l.id, title: l.title, priceVnd: l.price_vnd, bedrooms: l.bedrooms, areaSqm: l.area_sqm,
        confirmedAt: null, kind: 'advertised',
      })),
    ],
  };
}

/**
 * The one message (SPEC §11). The preview is the same renderOfferSections the
 * server sends, with the renter's first name left out - the console never has
 * it. When the same renter has another open request, its units can go in the
 * same message: two offers would leave the second waiting on a reply.
 */
function OfferComposer({ d, canReply, replyBlocked, busy, run }: {
  d: Detail; canReply: boolean; replyBlocked: string | null; busy: boolean; run: Run;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [line, setLine] = useState('');
  const [others, setOthers] = useState<OfferPart[]>([]);
  const now = new Date();
  const siblingIds = (d.siblings ?? []).map(s => s.id).join(',');

  useEffect(() => {
    let live = true;
    void (async () => {
      const loaded: OfferPart[] = [];
      for (const id of siblingIds ? siblingIds.split(',') : []) {
        const { data } = await supabase.rpc('ops_inquiry_detail', { _inquiry_id: id });
        if (!data) continue;
        const part = offerPart(data as Detail, new Date());
        if (part.open && part.candidates.length > 0) loaded.push(part);
      }
      if (live) setOthers(loaded);
    })();
    return () => { live = false; };
  }, [siblingIds]);

  const main = offerPart(d, now);
  const parts = [main, ...others];
  const usable = (p: OfferPart, c: OfferUnit) => !p.awaiting && !misfit(c, p.brief);
  const sections: OfferSection[] = parts
    .map(p => ({
      complexName: p.complexName,
      kind: p.place,
      inquiryId: p.inquiryId,
      units: p.candidates.filter(c => (picked[p.inquiryId] ?? []).includes(c.id) && usable(p, c)),
    }))
    .filter(s => s.units.length > 0);
  const total = sections.reduce((n, s) => n + s.units.length, 0);
  const mainSection = sections.find(s => s.inquiryId === d.id);

  const toggle = (inquiryId: string, id: string) => setPicked(prev => {
    const mine = prev[inquiryId] ?? [];
    if (mine.includes(id)) return { ...prev, [inquiryId]: mine.filter(x => x !== id) };
    if (mine.length >= MAX_OFFER_UNITS || total >= MAX_COMBINED_UNITS) return prev;
    return { ...prev, [inquiryId]: [...mine, id] };
  });

  if (main.candidates.length === 0) return null;
  const blocked = main.awaiting ? 'They have not answered the last offer yet - send more once they reply.' : replyBlocked;

  return (
    <div className="card">
      <strong>Offer units</strong>
      <span className="small muted">
        {' '}- one message, up to {MAX_OFFER_UNITS} per {d.area_district_codes ? 'search' : 'building'}; it uses one of the two messages they can get without replying.
      </span>
      {parts.map(p => (
        <div key={p.inquiryId} style={{ marginTop: 6 }}>
          {others.length > 0 && (
            <div className="small">
              <strong>{p.complexName}</strong>
              {p.inquiryId !== d.id && <span className="muted"> - the same renter's other request</span>}
              {p.awaiting && <span className="tag warn">waiting for their answer to the last offer</span>}
            </div>
          )}
          {p.candidates.map(c => {
            const off = misfit(c, p.brief);
            return (
              <label key={c.id} className="row small" style={{ marginBottom: 2 }}>
                <input type="checkbox" disabled={!usable(p, c)}
                  checked={(picked[p.inquiryId] ?? []).includes(c.id) && usable(p, c)}
                  onChange={() => toggle(p.inquiryId, c.id)} />
                <span className={off ? 'muted' : ''}>{c.title} · {formatVnd(c.priceVnd)}</span>
                <span className={`tag ${c.kind === 'confirmed' ? 'good' : ''}`}>{c.kind}</span>
                {off && <span className="tag warn" title="Offer it only if they say they would take it">{off}</span>}
              </label>
            );
          })}
        </div>
      ))}
      <input style={{ width: '100%', marginTop: 6 }} placeholder="Your own line, optional - e.g. which you would see first"
        value={line} onChange={e => setLine(e.target.value)} />
      {sections.length > 0 && (
        <div className="bubble" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {renderOfferSections({ firstName: '[first name]', sections, message: line, now })}
        </div>
      )}
      {sections.length > 0 && !mainSection && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          Pick at least one unit here too, or send it from the other request's screen.
        </p>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <span className="small muted">{blocked ?? ''}</span>
        <div className="spacer" />
        <button disabled={busy || !canReply || main.awaiting || !mainSection}
          onClick={() => void run(
            {
              action: 'INQUIRY_OFFER_UNITS',
              listingIds: mainSection!.units.map(u => u.id),
              alsoFor: sections.filter(s => s.inquiryId !== d.id)
                .map(s => ({ inquiryId: s.inquiryId, listingIds: s.units.map(u => u.id) })),
              message: line,
              key: crypto.randomUUID(),
            },
            () => { setPicked({}); setLine(''); },
          )}>
          Send offer on WhatsApp
        </button>
      </div>
    </div>
  );
}

const bedsText = (beds: number[]) => beds.map(n => (n >= 4 ? '4+' : String(n))).join(' or ') + ' BR';

/**
 * The brief in force, and a way to change it - only as the renter put it on
 * the thread. Units outside it cannot be offered (INQUIRY_OFFER_UNITS), so
 * "would you take a 3-bedroom?" is asked in a reply, and their answer recorded
 * here against their message.
 */
function BriefLine({ d, v, closed, busy, run }: { d: Detail; v: InquiryView; closed: boolean; busy: boolean; run: Run }) {
  const brief: Brief = briefOf({ bedrooms: d.bedrooms, budgetMaxVnd: d.budget_max_vnd }, v.brief);
  const said = [...d.thread].reverse().filter(m => m.direction === 'inbound');
  const [open, setOpen] = useState(false);
  const [messageId, setMessageId] = useState(said[0]?.id ?? '');
  const [beds, setBeds] = useState<number[]>(brief.bedrooms);
  const [budget, setBudget] = useState(brief.budgetMaxVnd ? String(brief.budgetMaxVnd / 1_000_000) : '');
  const ceiling = priceCeiling(brief);

  return (
    <div className="small" style={{ margin: '2px 0 4px' }}>
      <span className={v.brief ? '' : 'muted'}>
        {v.brief ? 'They now take: ' : 'Offers must fit: '}
        {bedsText(brief.bedrooms)}, {ceiling == null ? 'any price' : `up to ${formatVnd(ceiling)} (budget + 10%)`}
      </span>
      {!closed && said.length > 0 && !open && (
        <button className="link" disabled={busy} onClick={() => setOpen(true)}>they changed what they want</button>
      )}
      {open && (
        <div style={{ marginTop: 6 }}>
          <div className="row wrap-row">
            <span className="muted">Where they said it:</span>
            <select value={messageId} onChange={e => setMessageId(e.target.value)} style={{ maxWidth: 420 }}>
              {said.map(m => <option key={m.id} value={m.id}>{hcmc(m.created_at)} - {m.body.slice(0, 70)}</option>)}
            </select>
          </div>
          <div className="row wrap-row" style={{ marginTop: 4 }}>
            {[1, 2, 3, 4].map(n => (
              <label key={n}>
                <input type="checkbox" checked={beds.includes(n)}
                  onChange={() => setBeds(b => b.includes(n) ? b.filter(x => x !== n) : [...b, n])} /> {n === 4 ? '4+' : n} BR
              </label>
            ))}
            <input style={{ width: 90 }} placeholder="no limit" value={budget} onChange={e => setBudget(e.target.value)} />
            <span className="muted">million ₫ a month (blank for no limit)</span>
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="primary" disabled={busy || !messageId || beds.length === 0}
              onClick={() => void run({
                action: 'INQUIRY_CHANGE_BRIEF', messageId, bedrooms: beds,
                budgetMaxVnd: budget.trim() ? Math.round(Number(budget) * 1_000_000) : null,
              }, () => setOpen(false))}>
              Record it
            </button>
            <button disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AgentMessage {
  id: string; realtor_id: string | null; direction: 'OUT' | 'IN'; purpose: string;
  body: string; status: string; error: string | null; created_at: string;
  /** Photos the agent sent, copied into our storage by the bridge (S7.2b). */
  attachments?: { url: string }[] | null;
}

/**
 * The availability check to one agent (S7.2): the draft, editable - what is
 * sent is what is recorded. Through the Zalo device when the bridge is on;
 * otherwise the operator sends it from their phone and marks it sent.
 */
function AskBox({ agentName, initial, bridge, busy, onSend, onCancel }: {
  agentName: string; initial: string; bridge: boolean; busy: boolean;
  onSend: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div style={{ marginTop: 8 }}>
      <div className="small muted">
        To {agentName} on Zalo - no name or number of the renter; the server refuses both.
      </div>
      <textarea rows={9} value={text} onChange={e => setText(e.target.value)} style={{ marginTop: 4 }} />
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={() => void navigator.clipboard.writeText(text)}>Copy</button>
        <button className="primary" disabled={busy || !text.trim()} onClick={() => onSend(text)}>
          {bridge ? 'Send via the Zalo device' : 'Mark sent'}
        </button>
        <button disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** What an agent's reply adds to the capture form: a suggested unit, or photos. */
interface UnitIncoming {
  key: number;
  realtorId?: string | null;
  unit?: SuggestedUnit;
  addPhotos?: string[];
  /** A search's unit from an advertised listing: the district it is in. */
  districtCode?: string | null;
}

/**
 * What each agent was sent about this request and what they said, oldest
 * first. Their photos, copied into our storage by the bridge (S7.2b), go
 * onto a unit with one click; a reply in words can be read into suggested
 * units, which fill the capture form for the operator to check and add.
 */
function AgentConversations({ messages, nameOf, inquiryId, busy, onUse }: {
  messages: AgentMessage[];
  nameOf: (id: string | null) => string;
  inquiryId: string;
  busy: boolean;
  onUse: (incoming: Omit<UnitIncoming, 'key'>) => void;
}) {
  const [reading, setReading] = useState<string | null>(null);
  const [read, setRead] = useState<{ messageId: string; realtorId: string | null; suggestion: UnitSuggestion } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (messages.length === 0) return null;

  const suggest = async (m: AgentMessage) => {
    setReading(m.id);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('ops-parse-reply', { body: { inquiryId, reply: m.body } });
    setReading(null);
    const payload = data as { units?: UnitSuggestion; message?: string; error?: string } | null;
    if (err || !payload?.units) { setError(await invokeFailure(data, err) ?? payload?.message ?? 'Could not read it'); return; }
    setRead({ messageId: m.id, realtorId: m.realtor_id, suggestion: payload.units });
  };

  return (
    <details style={{ marginTop: 8 }} open={messages.some(m => m.direction === 'IN')}>
      <summary className="small muted">Agent conversations ({messages.length})</summary>
      <div className="thread">
        {messages.map(m => (
          <div key={m.id} className={`bubble ${m.direction === 'IN' ? 'in' : 'out'}`}>
            <div className="small muted">
              {m.direction === 'IN' ? nameOf(m.realtor_id) : `Hausto to ${nameOf(m.realtor_id)}`} · {hcmc(m.created_at)}
              {m.direction === 'OUT' && m.status !== 'SENT' ? ` · ${m.status.toLowerCase()}${m.error ? `: ${m.error}` : ''}` : ''}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            {(m.attachments ?? []).length > 0 && (
              <div className="row wrap-row" style={{ marginTop: 4 }}>
                {(m.attachments ?? []).map(a => (
                  <span key={a.url} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                    <a href={a.url} target="_blank" rel="noreferrer">
                      <img src={a.url} alt="From the agent" style={{ width: 96, height: 72, objectFit: 'cover' }} />
                    </a>
                    <button className="link small" disabled={busy}
                      onClick={() => onUse({ realtorId: m.realtor_id, addPhotos: [a.url] })}>add to unit</button>
                  </span>
                ))}
              </div>
            )}
            {m.direction === 'IN' && !m.body.startsWith('(') && (
              <button className="link small" disabled={busy || reading !== null} onClick={() => void suggest(m)}>
                {reading === m.id ? 'reading...' : 'suggest a unit from this'}
              </button>
            )}
            {read?.messageId === m.id && (
              <div className="proposal" style={{ marginTop: 4 }}>
                <div className="small">
                  <span className={`tag ${read.suggestion.confidence === 'HIGH' ? 'good' : 'warn'}`}>
                    {read.suggestion.answer.toLowerCase().replace('_', ' ')}
                  </span>{' '}
                  <span className="muted">{read.suggestion.note}</span>
                </div>
                {read.suggestion.units.map((u, i) => (
                  <div key={i} className="row wrap-row small" style={{ marginTop: 4 }}>
                    <span>
                      {u.bedrooms ? `${u.bedrooms >= 4 ? '4+' : u.bedrooms}BR` : '?BR'}
                      {u.areaSqm ? ` · ${u.areaSqm} m²` : ''}
                      {u.priceVnd ? ` · ${formatVnd(u.priceVnd)}` : ''}
                      {u.tower ? ` · ${u.tower}` : ''}{u.floor ? ` · floor ${u.floor}` : ''}
                    </span>
                    {u.problems.map(p => <span key={p} className="tag warn">{p}</span>)}
                    <button className="link small" onClick={() => onUse({ realtorId: read.realtorId, unit: u })}>fill the form</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="error small">{error}</p>}
    </details>
  );
}
