// The shell: sign in, prove the `ops` role, then show the queue, one request,
// or how the AI operator is scoring.
//
// Routing is a piece of state rather than a router. There are five screens
// and adding react-router to express that would be the first thing here that
// is not ugly and fast.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { SignIn } from './SignIn';
import { Queue } from './Queue';
import { RequestDetail } from './RequestDetail';
import { ShadowStats } from './ShadowStats';
import { Buildings } from './Buildings';
import { Availability } from './Availability';
import { NumberAlert } from './NumberStatus';

export function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [isOps, setIsOps] = useState<boolean | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [screen, setScreen] = useState<'queue' | 'availability' | 'shadow' | 'buildings'>('queue');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null);
      setIsOps(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // The role is checked here for the UI's sake only. RLS is what actually
  // decides: a signed-in renter reaching this page sees empty tables, because
  // no policy grants them a row - not because this flag said so.
  useEffect(() => {
    if (!userId) { setIsOps(null); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('user_roles').select('role').eq('user_id', userId).eq('role', 'ops').maybeSingle();
      if (!cancelled) setIsOps(!!data);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const signOut = useCallback(() => { void supabase.auth.signOut(); }, []);

  if (!userId) return <SignIn />;
  if (isOps === null) return <div className="wrap muted">Checking access...</div>;
  if (!isOps) {
    return (
      <div className="wrap">
        <p className="error">This account does not have the ops role.</p>
        <button onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="row nav" style={{ marginBottom: 16 }}>
        <strong>Hausto ops</strong>
        <button className={!requestId && screen === 'queue' ? 'active' : ''}
          onClick={() => { setRequestId(null); setScreen('queue'); }}>Queue</button>
        <button className={!requestId && screen === 'availability' ? 'active' : ''}
          onClick={() => { setRequestId(null); setScreen('availability'); }}>Availability</button>
        <button className={!requestId && screen === 'shadow' ? 'active' : ''}
          onClick={() => { setRequestId(null); setScreen('shadow'); }}>AI operator</button>
        <button className={!requestId && screen === 'buildings' ? 'active' : ''}
          onClick={() => { setRequestId(null); setScreen('buildings'); }}>Buildings</button>
        <div className="spacer" />
        <button onClick={signOut}>Sign out</button>
      </div>
      <NumberAlert />
      {requestId
        ? <RequestDetail requestId={requestId} onBack={() => setRequestId(null)} />
        : screen === 'shadow' ? <ShadowStats /> : screen === 'buildings' ? <Buildings /> : screen === 'availability' ? <Availability /> : <Queue onOpen={setRequestId} />}
    </div>
  );
}
