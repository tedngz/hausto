// The shell: sign in, prove the `ops` role, then one screen.
//
// Where you are lives in the URL hash rather than a router: six screens do
// not earn a dependency, but a link has to land somewhere. The digest email
// and the admin page link straight to a request (`#/request/<id>`,
// `#/inquiry/<id>`), and the browser's back button leaves it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { SignIn } from './SignIn';
import { Inbox } from './Inbox';
import { Queue } from './Queue';
import { RequestDetail } from './RequestDetail';
import { ShadowStats } from './ShadowStats';
import { Buildings } from './Buildings';
import { Availability } from './Availability';
import { NumberAlert } from './NumberStatus';
import { useInbox } from './useInbox';

type Screen = 'inbox' | 'viewings' | 'availability' | 'ai' | 'buildings';

interface Route {
  screen: Screen;
  requestId: string | null;
  inquiryId: string | null;
}

const SCREENS: Screen[] = ['inbox', 'viewings', 'availability', 'ai', 'buildings'];

function parseHash(hash: string): Route {
  const [first, id] = hash.replace(/^#\/?/, '').split('/');
  if (first === 'request' && id) return { screen: 'viewings', requestId: id, inquiryId: null };
  if (first === 'inquiry' && id) return { screen: 'availability', requestId: null, inquiryId: id };
  return { screen: (SCREENS as string[]).includes(first) ? first as Screen : 'inbox', requestId: null, inquiryId: null };
}

function go(path: string) {
  window.location.hash = `#/${path}`;
}

export function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [isOps, setIsOps] = useState<boolean | null>(null);
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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
  return <Console route={route} signOut={signOut} />;
}

function Console({ route, signOut }: { route: Route; signOut: () => void }) {
  const inbox = useInbox();
  // Back from a request goes to the list it was opened from - the Inbox for
  // one opened from an email link.
  const lastList = useRef<Screen>('inbox');
  if (!route.requestId && !route.inquiryId) lastList.current = route.screen;
  const work = (inbox.rows ?? []).filter(r => r.actionable);
  const count = (kinds: string[]) => work.filter(r => kinds.includes(r.kind)).length;
  const late = work.filter(r => r.urgency === 'LATE').length;

  const tab = (screen: Screen, label: string, n?: number) => (
    <button className={route.screen === screen && !route.requestId && !route.inquiryId ? 'active' : ''} onClick={() => go(screen)}>
      {label}{n ? <span className="count">{n}</span> : null}
    </button>
  );

  return (
    <div className="wrap">
      <div className="row nav wrap-row">
        <strong style={{ marginRight: 8 }}>Hausto ops</strong>
        {tab('inbox', 'Inbox', work.length)}
        {tab('viewings', 'Viewings', count(['VIEWING']))}
        {tab('availability', 'Availability & searches', count(['BUILDING', 'SEARCH']))}
        {tab('ai', 'AI operator')}
        {tab('buildings', 'Buildings')}
        {late > 0 && <span className="tag bad">{late} late</span>}
        <div className="spacer" />
        <button onClick={signOut}>Sign out</button>
      </div>
      <NumberAlert />
      {route.requestId
        ? <RequestDetail requestId={route.requestId} onBack={() => go(lastList.current)} />
        : route.screen === 'inbox'
          ? <Inbox rows={inbox.rows} error={inbox.error} onReload={() => void inbox.reload()}
              onOpen={r => go(`${r.kind === 'VIEWING' ? 'request' : 'inquiry'}/${r.id}`)} />
          : route.screen === 'ai' ? <ShadowStats />
            : route.screen === 'buildings' ? <Buildings />
              : route.screen === 'availability'
                ? <Availability openId={route.inquiryId} onOpen={id => go(id ? `inquiry/${id}` : lastList.current)} />
                : <Queue onOpen={id => go(`request/${id}`)} />}
    </div>
  );
}
