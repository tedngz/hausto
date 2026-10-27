// What the agent said about the terms, recorded by hand (LEASE_TERMS).
//
// The first message asks about whatever the ad leaves out, and the answer
// often comes in a reply the outcome form has already dealt with - "Thứ 7 10h
// được em, cọc 2 tháng, không nuôi thú cưng". Typed fields, like an outcome
// (invariant 2): the renter's plan prints them, so nothing here may need
// reading back out of a note. The latest record stands whole, so the form
// opens on what is on file, with any paste-parse reading over it.

import { useState } from 'react';
import {
  checkTerms,
  describeTerms,
  FEE_KINDS,
  FEE_LABELS,
  mergeTerms,
  NO_TERMS,
  type FeeKind,
  type LeaseTerms,
} from '../../supabase/functions/_shared/lease-terms';
import type { AgentTerms } from '../../supabase/functions/_shared/viewing-domain';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';

interface FeeRow { kind: FeeKind; label: string; included: boolean; amount: string }

const blankFee = (): FeeRow => ({ kind: 'MANAGEMENT', label: '', included: false, amount: '' });
const text = (n: number | null) => (n === null ? '' : String(n));

export function LeaseTermsForm({
  busy,
  recorded,
  suggested,
  onSave,
}: {
  busy: boolean;
  /** On file for this item (the view's `terms`). */
  recorded: AgentTerms | null;
  /** What paste-parse read in the reply just pasted, if it stated any. */
  suggested: LeaseTerms | null;
  onSave: (terms: LeaseTerms, note: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const start = suggested ? mergeTerms(suggested, recorded ?? NO_TERMS) : recorded ?? NO_TERMS;

  const [depositMin, setDepositMin] = useState(text(start.depositMonthsMin));
  const [depositMax, setDepositMax] = useState(text(start.depositMonthsMax));
  const [lease, setLease] = useState(text(start.minLeaseMonths));
  const [pets, setPets] = useState(start.petsAllowed === null ? '' : start.petsAllowed ? 'YES' : 'NO');
  const [free, setFree] = useState<string>(start.availability ?? '');
  const [freeFrom, setFreeFrom] = useState(start.availableFrom ?? '');
  const [fees, setFees] = useState<FeeRow[]>(start.fees.map(f => ({ ...f, amount: f.amount ?? '' })));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stated = describeTerms(recorded);

  if (!open) {
    return (
      <div className="row wrap-row small" style={{ marginTop: 8 }}>
        {stated.length > 0
          ? <span className="muted">Agent says: {stated.join('; ')} - recorded {hcmc(recorded!.recordedAt)}.</span>
          : <span className="muted">No terms recorded from the agent.</span>}
        {suggested && <span className="tag warn">the reply states terms</span>}
        <button className="link" disabled={busy} onClick={() => setOpen(true)}>
          {stated.length > 0 ? 'change' : 'record what the agent said'}
        </button>
      </div>
    );
  }

  const terms = (): LeaseTerms => ({
    availability: free === 'AVAILABLE_NOW' || free === 'AVAILABLE_SOON' ? free : null,
    availableFrom: free === 'AVAILABLE_SOON' && freeFrom ? freeFrom : null,
    minLeaseMonths: lease.trim() ? Number(lease) : null,
    depositMonthsMin: depositMin.trim() ? Number(depositMin) : null,
    depositMonthsMax: depositMax.trim() ? Number(depositMax) : depositMin.trim() ? Number(depositMin) : null,
    petsAllowed: pets === 'YES' ? true : pets === 'NO' ? false : null,
    fees: fees.map(f => ({ kind: f.kind, label: f.label.trim() || FEE_LABELS[f.kind], included: f.included, amount: f.amount.trim() || null })),
  });

  const save = async () => {
    // The server checks the same way; checking here says what is wrong before a round trip.
    const checked = checkTerms(terms());
    if (!checked.ok) { setError(checked.error); return; }
    setError(null);
    if (await onSave(checked.value, note)) setOpen(false);
  };

  const setFee = (i: number, patch: Partial<FeeRow>) => setFees(fees.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div style={{ marginTop: 8 }}>
      <div className="small muted">What the agent said - for the renter's plan. Leave blank what they did not say.</div>
      <div className="row wrap-row small" style={{ marginTop: 4 }}>
        <label>Deposit <input style={{ width: 50 }} inputMode="decimal" value={depositMin} onChange={e => setDepositMin(e.target.value)} /></label>
        <label>to <input style={{ width: 50 }} inputMode="decimal" value={depositMax} onChange={e => setDepositMax(e.target.value)} /> months</label>
        <label>Minimum lease <input style={{ width: 50 }} inputMode="numeric" value={lease} onChange={e => setLease(e.target.value)} /> months</label>
        <select value={pets} onChange={e => setPets(e.target.value)}>
          <option value="">Pets: not said</option>
          <option value="YES">Pets allowed</option>
          <option value="NO">No pets</option>
        </select>
        <select value={free} onChange={e => setFree(e.target.value)}>
          <option value="">Move-in: not said</option>
          <option value="AVAILABLE_NOW">Move in now</option>
          <option value="AVAILABLE_SOON">Move in from...</option>
        </select>
        {free === 'AVAILABLE_SOON' && <input type="date" value={freeFrom} onChange={e => setFreeFrom(e.target.value)} />}
      </div>

      {fees.map((f, i) => (
        <div key={i} className="row wrap-row small" style={{ marginTop: 4 }}>
          <select value={f.kind} onChange={e => setFee(i, { kind: e.target.value as FeeKind })}>
            {FEE_KINDS.map(k => <option key={k} value={k}>{FEE_LABELS[k]}</option>)}
          </select>
          <input placeholder={FEE_LABELS[f.kind]} value={f.label} onChange={e => setFee(i, { label: e.target.value })} />
          <label><input type="checkbox" checked={f.included} onChange={e => setFee(i, { included: e.target.checked })} /> in the rent</label>
          {!f.included && (
            <input placeholder="Amount, e.g. 3,500 VND/kWh" value={f.amount} onChange={e => setFee(i, { amount: e.target.value })} />
          )}
          <button className="link" onClick={() => setFees(fees.filter((_, j) => j !== i))}>remove</button>
        </div>
      ))}
      <div className="row wrap-row small" style={{ marginTop: 4 }}>
        <button className="link" onClick={() => setFees([...fees, blankFee()])}>+ fee</button>
        <input placeholder="Note (optional, never read)" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" disabled={busy} onClick={() => void save()}>Save terms</button>
        <button disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="error small" style={{ marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
