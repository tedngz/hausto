// The renter's own viewing requests: the places in each, where each stands,
// and the changes they may make (2026-10-08).
//
// Everything here comes from `viewing-request-manage`, which reduces the event
// log on the server and hands back words - `events` is not readable from a
// browser, and a client reducing half a log would show a state the system
// does not agree with. Every change goes back through the same function, is
// written as an event, and is told to the renter on WhatsApp when their window
// is open, so the thread and this tab say the same thing (renter-edits.ts).
//
// Adding a place is the request modal's join, opened from here with the
// places the renter saved - one way to ask for a viewing (invariant 8).
//
// Availability requests and Priority searches sit among them (2026-10-09),
// read-only: where each stands and the places we sent, each opening the same
// modal with the request remembered, so the viewing closes it (SPEC §11).

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, CalendarClock, ChevronDown, Loader2, MessageCircle, Plus, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AvailabilityPicker, PART_LABEL, prettyDate } from '@/components/AvailabilityPicker';
import { RequestViewingModal, type RequestSeed } from '@/components/RequestViewingModal';
import { cn } from '@/lib/utils';
import { rememberOfferInquiry } from '@/lib/offerInquiry';
import { MAX_ITEMS, type AvailabilityWindow, type DayPart } from '../../../supabase/functions/_shared/viewing/intake.ts';
import {
  VIEWINGS_PATH, type PlaceStatus, type RenterPlace, type RenterRequest, type RequestStage,
} from '../../../supabase/functions/_shared/viewing/renter-view.ts';
import type {
  InquiryStage, RenterFoundPlace, RenterInquiry,
} from '../../../supabase/functions/_shared/viewing/renter-inquiry-view.ts';
import { SEARCH_NAME } from '../../../supabase/functions/_shared/viewing/place.ts';

type ManagedRequest = RenterRequest & { waLink: string };
type ManagedInquiry = RenterInquiry & { waLink: string };

const QUERY_KEY = 'my-viewing-requests';

/** Closed requests fold away under the live ones. */
const CLOSED: ReadonlySet<RequestStage> = new Set(['DONE', 'NOTHING_FREE', 'CANCELLED']);
const INQUIRY_CLOSED: ReadonlySet<InquiryStage> = new Set(['VIEWING', 'NOTHING_FOUND', 'CLOSED', 'NOT_SENT']);

const INQUIRY_TONE: Record<InquiryStage, string> = {
  SEND_CODE: 'bg-primary/10 text-primary',
  CHECKING: 'bg-amber-100 text-amber-900',
  FOUND: 'bg-primary/10 text-primary',
  VIEWING: 'bg-muted text-muted-foreground',
  NOTHING_FOUND: 'bg-muted text-muted-foreground',
  CLOSED: 'bg-muted text-muted-foreground',
  NOT_SENT: 'bg-muted text-muted-foreground',
};

const INQUIRY_SHORT: Record<InquiryStage, string> = {
  SEND_CODE: 'Not sent yet',
  CHECKING: 'Asking agents',
  FOUND: 'Places found',
  VIEWING: 'Viewing requested',
  NOTHING_FOUND: 'Nothing found',
  CLOSED: 'Closed',
  NOT_SENT: 'Not sent',
};

/** One list, newest first: a viewing request or an availability request. */
type Entry =
  | { type: 'viewing'; key: string; createdAt: string; request: ManagedRequest }
  | { type: 'inquiry'; key: string; createdAt: string; inquiry: ManagedInquiry };

const STAGE_TONE: Record<RequestStage, string> = {
  ASKING: 'bg-amber-100 text-amber-900',
  NEW_TIMES: 'bg-primary/10 text-primary',
  PLANNING: 'bg-amber-100 text-amber-900',
  PLAN_READY: 'bg-primary/10 text-primary',
  PLAN_SENT: 'bg-primary/10 text-primary',
  LOCKED_IN: 'bg-emerald-100 text-emerald-900',
  DONE: 'bg-muted text-muted-foreground',
  NOTHING_FREE: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const STAGE_SHORT: Record<RequestStage, string> = {
  ASKING: 'Asking agents',
  NEW_TIMES: 'Pick other days',
  PLANNING: 'Plan coming',
  PLAN_READY: 'Plan ready',
  PLAN_SENT: 'Plan sent',
  LOCKED_IN: 'Locked in',
  DONE: 'Done',
  NOTHING_FREE: 'Nothing free',
  CANCELLED: 'Cancelled',
};

const PLACE_DOT: Record<PlaceStatus, string> = {
  ASKING: 'bg-amber-400 animate-pulse',
  FREE: 'bg-emerald-500',
  KEPT: 'bg-emerald-500',
  OTHER_TIMES: 'bg-sky-500',
  NEW_PRICE: 'bg-amber-500',
  NOT_KEPT: 'bg-muted-foreground/40',
  NOT_FREE: 'bg-muted-foreground/40',
  RENTED: 'bg-muted-foreground/40',
  NO_ANSWER: 'bg-muted-foreground/40',
  REMOVED: 'bg-transparent border border-muted-foreground/40',
};

function windowsText(windows: AvailabilityWindow[]): string {
  const byDate = new Map<string, DayPart[]>();
  for (const w of windows) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w.part as DayPart]);
  return [...byDate.entries()]
    .map(([d, parts]) => `${prettyDate(d)} ${parts.map(p => PART_LABEL[p].toLowerCase()).join(' & ')}`)
    .join(' · ');
}

function vnd(n: number): string {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

/** One call to the manage function, with its refusal said back as the server put it. */
async function manage(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('viewing-request-manage', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error((payload as { message?: string } | null)?.message ?? 'Something went wrong. Try again in a moment.');
  }
  return (data ?? {}) as Record<string, unknown>;
}

const newKey = () => `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const ViewingRequestsPane = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<{ requests: ManagedRequest[]; inquiries: ManagedInquiry[] }>({
    queryKey: [QUERY_KEY, user?.id],
    enabled: !!user?.id,
    staleTime: 15_000,
    queryFn: async () => {
      const r = await manage({ action: 'list' });
      return {
        requests: (r.requests ?? []) as ManagedRequest[],
        inquiries: (r.inquiries ?? []) as ManagedInquiry[],
      };
    },
  });

  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, body: Record<string, unknown>, done: string) => {
    setBusy(label);
    try {
      const r = await manage({ ...body, clientKey: newKey() });
      toast.success(done, {
        description: r.whatsapp === 'SENT' ? 'We have noted it in your WhatsApp chat too.' : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['free-viewing'] });
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!user) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {/* Back to this tab afterwards - a WhatsApp link asking for other days lands here. */}
        <Link to="/auth" state={{ returnTo: VIEWINGS_PATH }} className="underline">Sign in</Link> to see your viewing requests.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Your requests did not load. Try again in a moment.</p>;
  }

  const entries: Entry[] = [
    ...(data?.requests ?? []).map((r): Entry => ({ type: 'viewing', key: r.ref, createdAt: r.createdAt, request: r })),
    ...(data?.inquiries ?? []).map((q): Entry => ({ type: 'inquiry', key: q.id, createdAt: q.createdAt, inquiry: q })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (entries.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">No viewing requests yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Find places you like and hit <strong>Request viewing</strong> on each - we fit them into one trip.
        </p>
      </div>
    );
  }

  const isClosed = (e: Entry) => (e.type === 'viewing' ? CLOSED.has(e.request.stage) : INQUIRY_CLOSED.has(e.inquiry.stage));
  const live = entries.filter(e => !isClosed(e));
  const past = entries.filter(isClosed);
  const card = (e: Entry) => (e.type === 'viewing'
    ? <RequestCard key={e.key} request={e.request} busy={busy} run={run} />
    : <InquiryCard key={e.key} inquiry={e.inquiry} />);

  return (
    <div className="space-y-3 py-4">
      {live.map(card)}
      {live.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing in progress.</p>
      )}
      {past.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
            Past requests ({past.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3">
            {past.map(card)}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Ho_Chi_Minh' });

/**
 * An availability request or Priority search: what was asked, where it
 * stands, and the places we sent. Nothing to change here - that is a
 * conversation on its WhatsApp thread.
 */
function InquiryCard({ inquiry: q }: { inquiry: ManagedInquiry }) {
  const [seed, setSeed] = useState<RequestSeed | null>(null);
  const closed = INQUIRY_CLOSED.has(q.stage);
  const area = q.kind === 'AREA';
  const KindIcon = area ? Search : Building2;

  const requestViewing = (p: RenterFoundPlace) => {
    // As the offer link does: the viewing request carries this one, and closes it.
    rememberOfferInquiry(p.listingId, q.id);
    setSeed({ listingId: p.listingId, title: p.title, imageUrl: p.imageUrl });
  };

  return (
    <Card className={cn(closed && 'opacity-80')}>
      <CardContent className="space-y-3 p-4">
        {/* Header: which request, what for, and where it stands. */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{q.code}</span>
              <span className="text-xs text-muted-foreground">{shortDate(q.createdAt)}</span>
            </div>
            <p className="mt-0.5 text-sm font-medium">
              {`${SEARCH_NAME} ${area ? 'in' : 'at'} ${q.place}`}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{q.stageLabel}</p>
          </div>
          <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', INQUIRY_TONE[q.stage])}>
            {q.stage === 'CHECKING' && area ? 'Searching' : INQUIRY_SHORT[q.stage]}
          </span>
        </div>

        {/* What they asked for. */}
        {q.brief && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-muted-foreground">{q.brief}</span>
          </div>
        )}

        {/* What we found. */}
        {q.found.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {q.found.map(p => (
              <li key={p.listingId} className="flex items-start gap-3 px-3 py-2.5">
                <Link to={p.path} className="shrink-0">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" loading="lazy"
                      className={cn('h-12 w-12 rounded-md object-cover', !p.listed && 'grayscale opacity-50')} />
                  ) : (
                    <div className="h-12 w-12 rounded-md bg-muted" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={p.path}
                    className={cn('line-clamp-1 text-sm font-medium hover:underline', !p.listed && 'text-muted-foreground')}>
                    {p.title}
                  </Link>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {p.listed
                      ? [p.bedrooms ? `${p.bedrooms} bed` : null, p.priceVnd ? `${vnd(p.priceVnd)}/mo` : null].filter(Boolean).join(' · ')
                      : 'No longer available'}
                  </p>
                  {/* Under the place rather than beside it: a phone has no room for both. */}
                  {p.listed && (
                    <Button size="sm" variant="outline" className="mt-2 h-7 px-2.5 text-xs" onClick={() => requestViewing(p)}>
                      Request viewing
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {q.alertsUntil && (
          <p className="text-xs text-muted-foreground">
            Until {shortDate(q.alertsUntil)} we also tell you on WhatsApp when a new listing there fits.
          </p>
        )}

        {/* Before the code arrives, the form's own message, so sending it still starts the request. */}
        {q.stage !== 'NOT_SENT' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={q.stage === 'SEND_CODE' ? 'default' : 'ghost'} asChild>
              <a href={q.waLink} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-1.5 h-4 w-4" /> {q.stage === 'SEND_CODE' ? 'Send it on WhatsApp' : 'WhatsApp'}
              </a>
            </Button>
          </div>
        )}
      </CardContent>

      {seed && (
        <RequestViewingModal open onOpenChange={o => { if (!o) setSeed(null); }} seed={seed} />
      )}
    </Card>
  );
}

type Run = (label: string, body: Record<string, unknown>, done: string) => Promise<boolean>;

function RequestCard({ request: r, busy, run }: { request: ManagedRequest; busy: string | null; run: Run }) {
  const [timesOpen, setTimesOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<RenterPlace | null>(null);
  const closed = CLOSED.has(r.stage);
  const active = r.places.filter(p => p.status !== 'REMOVED');
  const showLockIn = r.stage === 'PLAN_SENT' || r.stage === 'LOCKED_IN';

  return (
    <Card className={cn(closed && 'opacity-80')}>
      <CardContent className="space-y-3 p-4">
        {/* Header: which request, and where it stands. */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{r.ref}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Ho_Chi_Minh' })}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{r.stageLabel}</p>
          </div>
          <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', STAGE_TONE[r.stage])}>
            {STAGE_SHORT[r.stage]}
          </span>
        </div>

        {/* The renter's times. */}
        {r.availability.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-muted-foreground">{windowsText(r.availability)}</span>
            {/* Asked for other days, it is the one thing to do here. */}
            {r.canChangeTimes && (
              <Button size="sm" variant={r.stage === 'NEW_TIMES' ? 'default' : 'ghost'}
                className={cn('h-7 px-2', r.stage !== 'NEW_TIMES' && 'text-primary')} onClick={() => setTimesOpen(true)}>
                {r.stage === 'NEW_TIMES' ? 'Pick other days' : 'Change times'}
              </Button>
            )}
          </div>
        )}

        {/* The places. */}
        <ul className="divide-y rounded-lg border">
          {r.places.map(p => (
            <li key={p.itemId} className="flex items-center gap-3 px-3 py-2.5">
              <Link to={`/property/${p.listingId}`} className="shrink-0">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" loading="lazy"
                    className={cn('h-12 w-12 rounded-md object-cover', p.status === 'REMOVED' && 'grayscale opacity-50')} />
                ) : (
                  <div className="h-12 w-12 rounded-md bg-muted" />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link to={`/property/${p.listingId}`}
                  className={cn('line-clamp-1 text-sm font-medium hover:underline', p.status === 'REMOVED' && 'text-muted-foreground line-through')}>
                  {p.title}
                </Link>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', PLACE_DOT[p.status])} aria-hidden="true" />
                  <span className={cn('line-clamp-1', (p.status === 'FREE' || p.status === 'KEPT') && 'font-medium text-emerald-700')}>
                    {p.label}
                  </span>
                  {p.status !== 'REMOVED' && <span className="hidden shrink-0 sm:inline">· {vnd(p.priceVnd)}/mo</span>}
                </div>
              </div>
              {p.canRemove && (
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${p.title}`} onClick={() => setRemoving(p)} disabled={!!busy}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>

        {/* What can be done. */}
        <div className="flex flex-wrap items-center gap-2">
          {r.canAdd && active.length < MAX_ITEMS && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} disabled={!!busy}>
              <Plus className="mr-1 h-4 w-4" /> Add a place
            </Button>
          )}
          {showLockIn && (
            <Button size="sm" variant={r.stage === 'PLAN_SENT' ? 'default' : 'ghost'} asChild>
              <Link to={`/lock-in/${r.ref}`}>{r.stage === 'PLAN_SENT' ? 'Lock in your plan' : 'Your plan'}</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <a href={r.waLink} target="_blank" rel="noreferrer">
              <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
            </a>
          </Button>
          {r.canCancel && (
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => setCancelOpen(true)} disabled={!!busy}>
              Cancel request
            </Button>
          )}
        </div>
      </CardContent>

      <ChangeTimesDialog open={timesOpen} onOpenChange={setTimesOpen} request={r} busy={busy === `times:${r.ref}`}
        onSave={async availability => {
          if (await run(`times:${r.ref}`, { action: 'times', ref: r.ref, availability }, `New times saved for ${r.ref}`)) setTimesOpen(false);
        }} />

      <AlertDialog open={!!removing} onOpenChange={o => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this place?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.title} comes out of {r.ref}, and we let its agent know. The rest of the request carries on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const p = removing;
                setRemoving(null);
                if (p) void run(`remove:${p.itemId}`, { action: 'remove', ref: r.ref, itemId: p.itemId }, `${p.title} removed`);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} request={r} busy={busy === `cancel:${r.ref}`}
        onCancel={async reason => {
          if (await run(`cancel:${r.ref}`, { action: 'cancel', ref: r.ref, reason }, `${r.ref} cancelled`)) setCancelOpen(false);
        }} />

      {addOpen && (
        <AddPlacesDialog open={addOpen} onOpenChange={setAddOpen} request={r} room={MAX_ITEMS - active.length} />
      )}
    </Card>
  );
}

function ChangeTimesDialog({ open, onOpenChange, request, busy, onSave }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  request: ManagedRequest;
  busy: boolean;
  onSave: (availability: AvailabilityWindow[]) => void;
}) {
  const [picked, setPicked] = useState<AvailabilityWindow[]>([]);
  const asked = request.places.some(p => p.status !== 'ASKING' && p.status !== 'REMOVED');
  return (
    <Dialog open={open} onOpenChange={o => { if (o) setPicked([]); onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New times for {request.ref}</DialogTitle>
          <DialogDescription>
            {asked
              ? 'We ask every agent again about the new times. Answers about the old ones no longer count.'
              : 'We ask the agents about these times instead.'}
          </DialogDescription>
        </DialogHeader>
        <AvailabilityPicker value={picked} onChange={setPicked} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Keep my times</Button>
          <Button disabled={picked.length === 0 || busy} onClick={() => onSave(picked)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save new times'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ open, onOpenChange, request, busy, onCancel }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  request: ManagedRequest;
  busy: boolean;
  onCancel: (reason: 'RENTER_FOUND_PLACE' | 'RENTER_DECLINED') => void;
}) {
  const locked = request.stage === 'LOCKED_IN';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {request.ref}?</DialogTitle>
          <DialogDescription>
            We let every agent know you are not coming.
            {locked ? ' A free viewing already used stays used.' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onCancel('RENTER_FOUND_PLACE')}>I found a place</Button>
          <Button variant="outline" disabled={busy} onClick={() => onCancel('RENTER_DECLINED')}>I no longer want these viewings</Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Keep the request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Pick from the places the renter saved, then hand them to the request modal,
 * which joins them to this request (or asks for the Pass, where adding needs
 * it - requestGate). The modal decides; this only chooses.
 */
function AddPlacesDialog({ open, onOpenChange, request, room }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  request: ManagedRequest;
  room: number;
}) {
  const { renterMatches, isLoadingMatches } = useMatches();
  const inRequest = useMemo(() => new Set(request.places.map(p => p.listingId)), [request.places]);
  const candidates = useMemo(() => renterMatches
    .filter(m => m.property_type === 'external' && m.properties && !inRequest.has(m.property_id))
    .map(m => ({
      listingId: m.property_id,
      title: m.properties!.title,
      imageUrl: m.properties!.images?.[0] ?? null,
    })), [renterMatches, inRequest]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [seeds, setSeeds] = useState<RequestSeed[] | null>(null);

  const toggle = (id: string) => setChosen(prev => prev.includes(id)
    ? prev.filter(x => x !== id)
    : prev.length >= room ? (toast.error(`${request.ref} has room for ${room} more.`), prev) : [...prev, id]);

  if (seeds) {
    return (
      <RequestViewingModal open onOpenChange={o => { if (!o) { setSeeds(null); onOpenChange(false); } }} seeds={seeds} />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to {request.ref}</DialogTitle>
          <DialogDescription>
            From the places you saved. They join the same plan, at the same times.
          </DialogDescription>
        </DialogHeader>
        {isLoadingMatches ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : candidates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No saved places to add. Tap the heart on a place in Browse to save it, or open it and hit
            <strong> Request viewing</strong> - it joins this request.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {candidates.map(c => {
              const on = chosen.includes(c.listingId);
              return (
                <li key={c.listingId}>
                  <button type="button" onClick={() => toggle(c.listingId)} aria-pressed={on}
                    className={cn('flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
                      on ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                    {c.imageUrl
                      ? <img src={c.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
                      : <div className="h-10 w-10 shrink-0 rounded bg-muted" />}
                    <span className="line-clamp-2 flex-1 text-sm">{c.title}</span>
                    <span className={cn('h-4 w-4 shrink-0 rounded-full border', on && 'border-primary bg-primary')} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={chosen.length === 0}
            onClick={() => setSeeds(candidates.filter(c => chosen.includes(c.listingId)))}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
