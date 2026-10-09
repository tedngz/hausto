// What the AI operator proposes for this request (stage 1, shadow mode).
//
// Each proposal is a typed action it would take, and why. The operator
// approves it (which runs it, as them, with any rewording), rejects it, or just
// does the work their own way on the cards below - which scores it as agreed or
// corrected. Nothing here is automatic: the AI operator never writes to the log.
//
// A message to an agent goes out by hand on Zalo, or through the Zalo device
// when the bridge is live. Approving means "I have sent this" in the first
// case and "send this" in the second, and the button says which.

import { useState } from 'react';
import { supabase, invokeFailure } from './supabase';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';

export interface ProposalRow {
  id: string;
  item_id: string | null;
  action: string;
  input: Record<string, unknown>;
  rationale: string;
  confidence: 'HIGH' | 'LOW';
  created_at: string;
  /** Stage 2: when the AI operator will run this itself, unless a person acts first. */
  execute_after: string | null;
}

const LABEL: Record<string, string> = {
  CONTACTED: 'Message the agent',
  NUDGE: 'Chase the agent',
  OUTCOME: 'Record an outcome',
  NOTIFY_REALTOR: 'Tell the agent',
  // The plan, other times, a question about days, or nothing left - the
  // rationale says which (planner.ts), as deliver() decides it.
  DELIVER: 'Send to the renter',
  CANCEL_REQUEST: 'Cancel the request',
  REPLY: 'Reply to the renter',
  ESCALATE: 'Needs a person',
};

/** Actions whose approval claims a message already went out on Zalo. */
const SENT_BY_HAND = new Set(['CONTACTED', 'NUDGE', 'NOTIFY_REALTOR']);

export function Proposals({
  requestId,
  proposals,
  bridge,
  titleFor,
  onChanged,
}: {
  requestId: string;
  proposals: ProposalRow[];
  /** Messages to agents go through the Zalo device, so approving sends them. */
  bridge: boolean;
  titleFor: (itemId: string) => string;
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setAsking(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('ai-operator-plan', { body: { requestId } });
    setAsking(false);
    setError(await invokeFailure(data, err));
    onChanged();
  };

  return (
    <div className="card shadow">
      <div className="row wrap-row">
        <strong>AI operator</strong>
        <span className="small muted">shadow mode - proposes, you decide</span>
        <div className="spacer" />
        <button disabled={asking} onClick={() => void ask()}>{asking ? 'Thinking...' : 'Ask again'}</button>
      </div>
      {proposals.length === 0 && <p className="small muted" style={{ marginBottom: 0 }}>Nothing proposed for this request.</p>}
      {proposals.map(p => (
        <ProposalCard key={p.id} p={p} bridge={bridge} titleFor={titleFor} onChanged={onChanged} />
      ))}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function summary(p: ProposalRow, titleFor: (id: string) => string): string {
  const i = p.input;
  if (p.action === 'OUTCOME') {
    const slots = Array.isArray(i.slots) ? (i.slots as { startsAt: string }[]).map(s => hcmc(s.startsAt)).join(', ') : '';
    return [String(i.outcome), slots, i.actualPriceVnd ? `${i.actualPriceVnd} ₫` : ''].filter(Boolean).join(' - ');
  }
  if (p.action === 'DELIVER' && Array.isArray(i.order)) {
    return (i.order as string[]).map((id, n) => `${n + 1}. ${titleFor(id)}`).join('  ');
  }
  if (p.action === 'NOTIFY_REALTOR') return String(i.decision).toLowerCase();
  if (p.action === 'CANCEL_REQUEST') return String(i.reason).toLowerCase().replace(/_/g, ' ');
  return '';
}

function ProposalCard({
  p,
  bridge,
  titleFor,
  onChanged,
}: {
  p: ProposalRow;
  bridge: boolean;
  titleFor: (itemId: string) => string;
  onChanged: () => void;
}) {
  const hasMessage = typeof p.input.message === 'string';
  const [message, setMessage] = useState(String(p.input.message ?? ''));
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('ops-record-outcome', { body });
    setBusy(false);
    const failure = await invokeFailure(data, err);
    if (failure) { setError(failure); return; }
    onChanged();
  };

  const approve = () => decide({
    action: 'APPROVE_PROPOSAL',
    proposalId: p.id,
    overrides: hasMessage && message !== p.input.message ? { message } : {},
  });

  const detail = summary(p, titleFor);

  return (
    <div className="proposal">
      <div className="row wrap-row small">
        <span className={`tag ${p.action === 'ESCALATE' ? 'warn' : 'good'}`}>{LABEL[p.action] ?? p.action}</span>
        {p.item_id && <strong>{titleFor(p.item_id)}</strong>}
        {p.confidence === 'LOW' && <span className="tag warn">unsure</span>}
        <div className="spacer" />
        <span className="muted">{hcmc(p.created_at)}</span>
      </div>
      {p.execute_after && (
        <div className="small age-warn" style={{ marginTop: 4 }}>
          The AI operator will send this itself at {hcmc(p.execute_after)} unless you act.
          Editing the text does not stop it - send it, hold it, or reject it.{' '}
          <button className="link" disabled={busy} onClick={() => void decide({ action: 'HOLD_PROPOSAL', proposalId: p.id })}>
            Hold - I will handle it
          </button>
        </div>
      )}
      <div className="small" style={{ marginTop: 4 }}>{p.rationale}</div>
      {detail && <div className="small muted" style={{ marginTop: 2 }}>{detail}</div>}

      {hasMessage && (
        <textarea rows={4} value={message} onChange={e => setMessage(e.target.value)} style={{ marginTop: 6 }} />
      )}

      {!rejecting ? (
        <div className="row wrap-row" style={{ marginTop: 6 }}>
          {hasMessage && (
            <button onClick={async () => {
              await navigator.clipboard.writeText(message);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}>{copied ? 'Copied' : 'Copy'}</button>
          )}
          <button className="primary" disabled={busy || (hasMessage && !message.trim())} onClick={() => void approve()}>
            {p.action === 'ESCALATE' ? 'Agree - I will handle it'
              : SENT_BY_HAND.has(p.action) ? (bridge ? 'Approve - the Zalo device sends it' : 'Sent it on Zalo - approve')
              : p.action === 'REPLY' ? 'Send to the renter on WhatsApp'
              : 'Approve'}
          </button>
          <button disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
        </div>
      ) : (
        <div className="row wrap-row" style={{ marginTop: 6 }}>
          <input placeholder="Why not? (optional, helps the next version)" value={note}
            onChange={e => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="primary" disabled={busy} onClick={() => void decide({ action: 'REJECT_PROPOSAL', proposalId: p.id, note })}>
            Reject
          </button>
          <button disabled={busy} onClick={() => setRejecting(false)}>Back</button>
        </div>
      )}
      {error && <p className="error small" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}
