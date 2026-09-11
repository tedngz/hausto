// /dev/phone - a fake WhatsApp thread over the real `messages` table.
//
// It is not a simulation of the data, only of the surface: MockAdapter writes
// the same rows CloudApiAdapter will, and the inbound box goes through the same
// recordInbound the live webhook uses. A mock that took a shortcut anywhere in
// there would be worthless as a rehearsal.
import { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Send, RefreshCw } from 'lucide-react';

interface Msg {
  id: string;
  direction: 'IN' | 'OUT';
  body: string | null;
  template_name: string | null;
  status: string;
  created_at: string;
  error: string | null;
}
interface Renter {
  id: string;
  phone_e164: string;
  display_name: string | null;
  service_window_expires_at: string | null;
  opted_out_at: string | null;
}

export default function DevPhone() {
  const { user } = useAuth();
  const [renters, setRenters] = useState<Renter[]>([]);
  const [phone, setPhone] = useState('');
  const [renter, setRenter] = useState<Renter | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('dev-phone', { body });
    if (error) throw error;
    if (data?.error === 'Forbidden') { setDenied(true); throw new Error('Admin only'); }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  useEffect(() => {
    if (!user) return;
    call({ action: 'renters' })
      .then(d => setRenters(d.renters ?? []))
      .catch(() => {/* denied is handled in call */});
  }, [user, call]);

  const load = useCallback(async (p: string) => {
    if (!p) return;
    setBusy(true);
    try {
      const d = await call({ action: 'thread', phone: p });
      setRenter(d.renter);
      setMessages(d.messages ?? []);
      setWindowOpen(!!d.windowOpen);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [call]);

  const sendInbound = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const d = await call({ action: 'inbound', phone, text: draft });
      setDraft('');
      if (d.optedOut) toast.warning('That message opted this number out');
      await load(phone);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return <main className="mx-auto max-w-md px-4 py-20 text-center text-muted-foreground">Sign in to use /dev/phone.</main>;
  }
  if (denied) {
    return <main className="mx-auto max-w-md px-4 py-20 text-center text-muted-foreground">Admin only.</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Helmet><title>/dev/phone · Hausto</title></Helmet>

      <h1 className="text-xl font-semibold">/dev/phone</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        The renter's side of the thread. Outbound rows are written by whichever adapter is
        configured; the box below plays the part of the renter replying.
      </p>

      <div className="flex gap-2">
        <Input placeholder="+84901234567" value={phone} onChange={e => setPhone(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && load(phone)} />
        <Button variant="secondary" onClick={() => load(phone)} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {renters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {renters.map(r => (
            <button key={r.id} onClick={() => { setPhone(r.phone_e164); load(r.phone_e164); }}
                    className="rounded-full border px-2 py-0.5 text-xs hover:border-muted-foreground/50">
              {r.display_name || r.phone_e164}
            </button>
          ))}
        </div>
      )}

      {renter && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>{renter.display_name || renter.phone_e164}</span>
              <span className="flex gap-2">
                {/* The window is the whole reason sending is not always allowed,
                    so it is on screen rather than discovered through a 409. */}
                <Badge variant={windowOpen ? 'default' : 'secondary'}>
                  {windowOpen ? 'window open' : 'window shut'}
                </Badge>
                {renter.opted_out_at && <Badge variant="destructive">opted out</Badge>}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    m.direction === 'OUT' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}>
                    {m.template_name && (
                      <div className="mb-1 text-[10px] uppercase opacity-70">template: {m.template_name}</div>
                    )}
                    <div className="whitespace-pre-wrap">{m.body || <em className="opacity-70">(no body)</em>}</div>
                    <div className="mt-1 text-[10px] opacity-70">
                      {new Date(m.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })}
                      {m.direction === 'OUT' && ` · ${m.status.toLowerCase()}`}
                    </div>
                    {m.error && <div className="mt-1 text-[10px] text-destructive-foreground">{m.error}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2 border-t pt-3">
              <Input placeholder="Reply as the renter…" value={draft}
                     onChange={e => setDraft(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && sendInbound()} />
              <Button onClick={sendInbound} disabled={busy || !draft.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              An inbound message re-opens the 24-hour window. Send "stop" to opt this number out.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
