// Buildings: who we can ask about each one (PLAN-v3 S7.0).
//
// An availability request is answered by asking the agents who hold units in
// the building, and most buildings have nobody on file. This screen is where
// the ones an operator finds - in the building's Zalo and Facebook groups, or
// at the management company's leasing desk - are recorded, beside the agents
// found from their listings. Buildings people have asked about come first.
//
// Reads through ops_building_roster(); writes through ops-record-outcome, the
// same door every other operator action uses (invariant 10).

import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeFailure } from './supabase';
import { ROSTER_TARGET, rosterGap } from '../../supabase/functions/_shared/viewing/roster';

interface Agent {
  realtor_id: string;
  name: string | null;
  agency: string | null;
  phone: string;
  sources: ('LISTING' | 'MANUAL' | 'MANAGEMENT')[];
  note: string | null;
  added_at: string | null;
  listings: number;
  listings_total: number;
  last_listed_at: string | null;
  last_reply_at: string | null;
}

interface Building {
  id: string;
  name: string;
  slug: string | null;
  district: string | null;
  management_company: string | null;
  requests: number;
  last_request_at: string | null;
  agents: Agent[];
}

/** One number across this many listings is an agency desk, not someone in the building. */
const DESK_LISTINGS = 30;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' }) : '-';

async function act(body: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('ops-record-outcome', { body });
  return invokeFailure(data, error);
}

function AddAgent({ building, onDone }: { building: Building; onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [agency, setAgency] = useState('');
  const [source, setSource] = useState<'MANUAL' | 'MANAGEMENT'>('MANUAL');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await act({
      action: 'ADD_BUILDING_AGENT', complexId: building.id, phone, name, agency, source, note,
    });
    setBusy(false);
    if (err) { setError(err); return; }
    setPhone(''); setName(''); setAgency(''); setNote('');
    onDone();
  };

  return (
    <div className="proposal">
      <div className="row wrap-row">
        <input placeholder="Phone (Zalo) 0901 234 567" value={phone} onChange={e => setPhone(e.target.value)} />
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="Agency (optional)" value={agency} onChange={e => setAgency(e.target.value)} />
        <select value={source} onChange={e => setSource(e.target.value as 'MANUAL' | 'MANAGEMENT')}>
          <option value="MANUAL">Met in groups / referral</option>
          <option value="MANAGEMENT">Management leasing desk</option>
        </select>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input style={{ flex: 1 }} placeholder="Note - which tower, how you met, what they hold (optional)"
          value={note} onChange={e => setNote(e.target.value)} />
        <button disabled={busy || !phone.trim()} onClick={() => void submit()}>Add agent</button>
      </div>
      {error && <p className="error small" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}

function BuildingCard({ building, onChange }: { building: Building; onChange: () => void }) {
  const [open, setOpen] = useState(building.requests > 0 && building.agents.length < ROSTER_TARGET);
  const [error, setError] = useState<string | null>(null);
  const gap = rosterGap(building.agents.length);

  const remove = async (a: Agent) => {
    if (!confirm(`Take ${a.name ?? a.phone} off ${building.name}? Their contact stays on file.`)) return;
    const err = await act({ action: 'REMOVE_BUILDING_AGENT', complexId: building.id, realtorId: a.realtor_id });
    if (err) setError(err); else onChange();
  };

  return (
    <div className="card">
      <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <strong>{building.name}</strong>
        <span className="small muted">{building.district ?? ''}{building.management_company ? ` · ${building.management_company}` : ''}</span>
        <div className="spacer" />
        {building.requests > 0 && (
          <span className="tag warn" title={`Last ${day(building.last_request_at)}`}>
            {building.requests} request{building.requests === 1 ? '' : 's'}
          </span>
        )}
        <span className={`tag ${gap === 0 ? 'good' : building.agents.length === 0 ? 'bad' : 'warn'}`}>
          {building.agents.length} agent{building.agents.length === 1 ? '' : 's'}{gap > 0 ? ` - ${gap} short` : ''}
        </span>
      </div>

      {open && (
        <>
          {building.agents.length === 0 && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Nobody on file. Try the building's Zalo and Facebook agent groups
              {building.management_company ? `, and ${building.management_company}'s leasing desk` : ''}.
            </p>
          )}
          {building.agents.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Agent</th><th>Phone</th><th>How</th><th>Listings here</th><th>Last listed</th><th>Last replied</th><th /></tr>
              </thead>
              <tbody>
                {building.agents.map(a => (
                  <tr key={a.realtor_id}>
                    <td>
                      {a.name ?? <span className="muted">no name</span>}
                      {a.agency && <span className="small muted"> · {a.agency}</span>}
                      {a.listings_total >= DESK_LISTINGS && (
                        <span className="tag warn" title={`${a.listings_total} listings across the city`}> agency desk</span>
                      )}
                      {a.note && <div className="small muted">{a.note}</div>}
                    </td>
                    <td className="small">{a.phone}</td>
                    <td className="small">{a.sources.map(s => s === 'LISTING' ? 'listed here' : s === 'MANAGEMENT' ? 'management' : 'added').join(', ')}</td>
                    <td>{a.listings}</td>
                    <td className="small">{day(a.last_listed_at)}</td>
                    <td className="small">{day(a.last_reply_at)}</td>
                    <td>
                      {(a.sources.includes('MANUAL') || a.sources.includes('MANAGEMENT')) && (
                        <button className="link small" onClick={() => void remove(a)}>remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <p className="error small">{error}</p>}
          <AddAgent building={building} onDone={onChange} />
        </>
      )}
    </div>
  );
}

export function Buildings() {
  const [rows, setRows] = useState<Building[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('ops_building_roster');
    if (err) { setError(err.message); return; }
    setRows((data ?? []) as Building[]);
    setError(null);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading...</p>;

  const empty = rows.filter(b => b.agents.length === 0).length;
  const short = rows.filter(b => b.agents.length > 0 && rosterGap(b.agents.length) > 0).length;

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Buildings</h2>
        <span className="tag bad">{empty} with nobody</span>
        <span className="tag warn">{short} under {ROSTER_TARGET}</span>
        <div className="spacer" />
        <button onClick={() => void load()}>Refresh</button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Who we can ask when a renter requests availability. Buildings with requests first.
      </p>
      {rows.map(b => <BuildingCard key={b.id} building={b} onChange={() => void load()} />)}
    </>
  );
}
