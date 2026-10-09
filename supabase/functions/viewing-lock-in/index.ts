// The lock-in page's one endpoint (the pricing rework, SPEC §9).
//
//   POST { ref, action: 'view' }  - the plan, its deadline, and what covers it
//   POST { ref, action: 'lock', cover: 'PASS' | 'FREE_VIEWING', itemId? }
//
// Signed in, and only for the account the request belongs to: a ref is short
// and read aloud, so it is not a credential. Someone else's ref answers as an
// unknown one rather than saying it exists.
//
// Buying the Pass is not here: the page opens a Polar checkout through
// `create-pass-order` with the ref, and the plan is locked in where the
// purchase is recorded (`_shared/polar-pass.ts`), so it holds even if the
// renter never comes back to the page.
//
// The plan carries no agent field, so showing it to an unpaid renter gives
// nothing away. Lock-in confirms on the web and sends nothing on WhatsApp:
// paying is not a reply, and a "locked in" message would make the viewing-day
// message a third in a row, which the send service refuses.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, isRateLimited } from '../_shared/rate-limit.ts';
import {
  freeViewingAvailable,
  loadLockIn,
  lockIn,
  planPassCover,
} from '../_shared/viewing/lock-in-run.ts';
import { LOCK_IN_REFUSAL_COPY, PASS_DAYS, PASS_PRICE_USD } from '../_shared/viewing/lock-in.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const STATUS_COPY: Record<string, string> = {
  NOT_READY: 'We are still hearing back from the agents. Your plan comes on WhatsApp once they answer.',
  PAYING: 'Your payment is going through - the plan is held for it.',
  LAPSED: 'The time to lock in this plan has passed, and its agents have been told.',
  CLOSED: 'This request is closed.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  if (await isRateLimited(`viewing-lock-in:${clientIp(req)}`, 60, 3600)) {
    return json({ error: 'rate_limited', message: 'Too many tries. Wait a little and reload.' }, 429);
  }

  // verify_jwt stays false in config.toml so a signed-out visitor gets a
  // reason the page can show rather than the platform's bare 401.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const { data: authData } = jwt ? await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt) : { data: null };
  const user = authData?.user;
  if (!user) return json({ error: 'sign_in_required', message: 'Sign in to see your plan.' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const ref = String(body.ref ?? '').trim().toUpperCase();
  if (!ref) return json({ error: 'missing_ref' }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();
  const ctx = await loadLockIn(db, { ref }, now);
  if (!ctx || ctx.userId !== user.id) {
    return json({ error: 'unknown_request', message: `We could not find ${ref} on this account.` }, 404);
  }

  if (body.action === 'lock') {
    const cover = body.cover === 'FREE_VIEWING' ? 'FREE_VIEWING' : 'PASS';
    const result = await lockIn(db, ctx, {
      userId: user.id,
      choice: cover === 'FREE_VIEWING'
        ? { cover, itemId: typeof body.itemId === 'string' ? body.itemId : null }
        : { cover },
      actor: 'RENTER',
      now,
    });
    if (!result.ok) {
      const message = result.reason === 'NOT_OPEN'
        ? STATUS_COPY[result.status ?? 'CLOSED'] ?? STATUS_COPY.CLOSED
        : result.reason in LOCK_IN_REFUSAL_COPY
          ? LOCK_IN_REFUSAL_COPY[result.reason as keyof typeof LOCK_IN_REFUSAL_COPY]
          : 'Something went wrong on our side. Try again in a moment.';
      return json({ error: result.reason.toLowerCase(), message }, result.reason === 'WRITE_FAILED' ? 500 : 409);
    }
    console.log(`[viewing-lock-in] ${ctx.ref} locked in (${result.cover}, ${result.confirmedItemIds.length})`);
    return json({ success: true, cover: result.cover, confirmedItemIds: result.confirmedItemIds, already: result.already });
  }

  // `hasPass` is the Pass covering this plan - live now, or live when it was
  // requested - since that is what the page offers to lock it in with.
  const [hasPass, freeAvailable] = await Promise.all([
    planPassCover(db, ctx),
    freeViewingAvailable(db, ctx.phoneE164),
  ]);
  return json({
    ref: ctx.ref,
    status: ctx.status,
    statusMessage: STATUS_COPY[ctx.status] ?? null,
    deadline: ctx.deadline,
    stops: ctx.stops,
    hasPass,
    freeViewingAvailable: freeAvailable,
    lockedIn: ctx.status === 'LOCKED_IN'
      ? { cover: ctx.view.confirmedCover ?? null, itemIds: ctx.view.confirmedItemIds }
      : null,
    pass: { priceUsd: PASS_PRICE_USD, days: PASS_DAYS },
  });
});
