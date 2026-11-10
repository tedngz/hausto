// The Zalo device (stage 3, bridge/README.md): is it alive, what has it sent
// today, and the switch that stops it sending.
//
// Pausing stops the outbox only. The device keeps forwarding agents' replies,
// because pausing what we say is no reason to lose what they said.

import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeFailure } from './supabase';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';

interface Status {
  last_seen_at: string | null;
  device: string | null;
  version: string | null;
  sent_today: number;
  last_error: string | null;
  paused: boolean;
}

/**
 * The device checks in every 2 minutes (bridge POLL_MS, since 2026-11-04), so
 * five minutes of silence - two missed check-ins - is down. A device that
 * cannot log in to Zalo reports that without checking in, so it reads as
 * offline here with its reason underneath.
 */
const ONLINE_WITHIN_MS = 5 * 60_000;

export function BridgeStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: s }, { count }] = await Promise.all([
      supabase.from('zalo_bridge_status').select('last_seen_at, device, version, sent_today, last_error, paused')
        .eq('id', 'singleton').maybeSingle(),
      supabase.from('realtor_messages').select('id', { count: 'exact', head: true })
        .eq('direction', 'OUT').eq('status', 'QUEUED'),
    ]);
    setStatus((s as Status) ?? null);
    setQueued(count ?? 0);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const setPaused = async (paused: boolean) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('ops-record-outcome', { body: { action: 'SET_BRIDGE', paused } });
    setBusy(false);
    const failure = await invokeFailure(data, err);
    if (failure) { setError(failure); return; }
    void load();
  };

  if (!status) return null;
  const online = !!status.last_seen_at && Date.now() - Date.parse(status.last_seen_at) < ONLINE_WITHIN_MS;

  return (
    <div className="card">
      <div className="row wrap-row">
        <strong>Zalo device</strong>
        <span className={`tag ${online ? 'good' : 'bad'}`}>{online ? 'online' : status.last_seen_at ? 'offline' : 'never connected'}</span>
        {status.paused && <span className="tag bad">sending paused</span>}
        <div className="spacer" />
        {status.paused
          ? <button disabled={busy} onClick={() => void setPaused(false)}>Resume sending</button>
          : <button disabled={busy} onClick={() => void setPaused(true)}>Pause sending</button>}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {status.last_seen_at ? `Last seen ${hcmc(status.last_seen_at)}` : 'No heartbeat yet'}
        {status.device ? ` - ${status.device}` : ''}{status.version ? ` ${status.version}` : ''}
        {` - ${status.sent_today} sent today - ${queued} waiting to send`}
      </div>
      {status.last_error && <div className="small error" style={{ marginTop: 4 }}>{status.last_error}</div>}
      {!online && queued > 0 && (
        <div className="small age-warn" style={{ marginTop: 4 }}>
          {queued} message{queued === 1 ? '' : 's'} waiting and the device is not connected - nothing is reaching agents.
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
