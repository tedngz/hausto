// The hub's Viewings tab (2026-10-08): the renter's requests with the places
// in them and where each stands, and the changes they may make.
//
//   POST { action: 'list' }
//   POST { action: 'remove', ref, itemId, clientKey? }
//   POST { action: 'times', ref, availability, clientKey? }
//   POST { action: 'cancel', ref, reason: 'RENTER_FOUND_PLACE' | 'RENTER_DECLINED', clientKey? }
//
// Signed in, and only for the account each request belongs to: a ref is
// short and read aloud, so it is not a credential, and someone else's answers
// as unknown. Status is reduced here and handed over as words
// (renter-view.ts), with no agent field of any kind (SPEC §6). The changes
// are renter-edits.ts; this proves who is asking and sends the ops email.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, isRateLimited } from '../_shared/rate-limit.ts';
import { reduceRequest, type DomainEvent } from '../_shared/viewing-domain.ts';
import { buildDeepLink, hcmcDate, type AvailabilityWindow } from '../_shared/viewing/intake.ts';
import { findOpenRequests } from '../_shared/viewing/open-request.ts';
import { renterRequestView } from '../_shared/viewing/renter-view.ts';
import { applyRenterEdit, type RenterEdit } from '../_shared/viewing/renter-edits.ts';
import { sendIntakeAlert } from '../_shared/viewing/ops-alert.ts';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { realtorChannelFromEnv } from '../_shared/realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../_shared/realtor/store.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BUSINESS_PHONE = Deno.env.get('WHATSAPP_BUSINESS_PHONE') || '+84000000000';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** How far back the tab looks. Older requests are history nobody acts on. */
const LIST_DAYS = 90;

// deno-lint-ignore no-explicit-any
type Supa = any;

async function list(db: Supa, userId: string) {
  const since = new Date(Date.now() - LIST_DAYS * 86_400_000).toISOString();
  const { data: rows } = await db
    .from('viewing_requests')
    .select('id, ref, created_at, availability, renters!inner(user_id)')
    .eq('renters.user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  const requests = (rows ?? []) as { id: string; ref: string; created_at: string; availability: unknown }[];
  if (requests.length === 0) return [];

  const ids = requests.map(r => r.id);
  const [{ data: events }, { data: items }, open] = await Promise.all([
    db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at').in('request_id', ids),
    db.from('ops_request_items_view')
      .select('id, request_id, listing_id, listing_title, district_code, price_vnd_at_request').in('request_id', ids),
    findOpenRequests(db, userId, hcmcDate(new Date())).catch(() => ({ joinable: null, blocking: null })),
  ]);
  const itemRows = (items ?? []) as Record<string, unknown>[];
  const listingIds = [...new Set(itemRows.map(i => String(i.listing_id)))];
  const { data: listings } = listingIds.length
    ? await db.from('external_properties').select('id, images').in('id', listingIds)
    : { data: [] };
  const imageOf = new Map(((listings ?? []) as { id: string; images: string[] | null }[])
    .map(l => [l.id, l.images?.find(u => typeof u === 'string' && u.startsWith('http')) ?? null]));

  const now = Date.now();
  return requests.map(r => {
    const view = reduceRequest(r.id, ((events ?? []) as DomainEvent[]).filter(e => e.request_id === r.id));
    return {
      ...renterRequestView({
        view,
        ref: r.ref,
        createdAt: r.created_at,
        availability: Array.isArray(r.availability) ? r.availability as AvailabilityWindow[] : [],
        rows: itemRows.filter(i => i.request_id === r.id).map(i => ({
          itemId: String(i.id),
          listingId: String(i.listing_id),
          title: String(i.listing_title ?? 'A place'),
          imageUrl: imageOf.get(String(i.listing_id)) ?? null,
          districtCode: (i.district_code as string | null) ?? null,
          priceVndAtRequest: Number(i.price_vnd_at_request ?? 0),
        })),
        canAdd: open.joinable?.ref === r.ref,
        now,
      }),
      waLink: buildDeepLink(BUSINESS_PHONE, r.ref),
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  if (await isRateLimited(`viewing-manage:${clientIp(req)}`, 120, 3600)) {
    return json({ error: 'rate_limited', message: 'Too many tries. Wait a little and reload.' }, 429);
  }

  // verify_jwt stays false in config.toml so a signed-out visitor gets a
  // reason the tab can show rather than the platform's bare 401.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const { data: authData } = jwt ? await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt) : { data: null };
  const user = authData?.user;
  if (!user) return json({ error: 'sign_in_required', message: 'Sign in to see your requests.' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    if (body.action === 'list' || !body.action) return json({ requests: await list(db, user.id) });

    const ref = String(body.ref ?? '').trim().toUpperCase();
    const { data: request } = await db
      .from('viewing_requests')
      .select('id, ref, renter_id, availability, renters!inner(user_id)')
      .eq('ref', ref)
      .maybeSingle();
    if (!request || request.renters?.user_id !== user.id) {
      return json({ error: 'unknown_request', message: `We could not find ${ref || 'that request'} on this account.` }, 404);
    }

    let edit: RenterEdit;
    if (body.action === 'remove') edit = { kind: 'REMOVE_PLACE', itemId: String(body.itemId ?? '') };
    else if (body.action === 'times') edit = { kind: 'CHANGE_TIMES', availability: body.availability };
    else if (body.action === 'cancel') {
      edit = { kind: 'CANCEL', reason: body.reason === 'RENTER_FOUND_PLACE' ? 'RENTER_FOUND_PLACE' : 'RENTER_DECLINED' };
    } else return json({ error: 'unknown_action' }, 400);

    const env = Deno.env.toObject();
    const result = await applyRenterEdit(db, {
      whatsapp: adapterFromEnv(env),
      messages: new SupabaseMessageStore(db),
      realtorChannel: realtorChannelFromEnv(env),
      realtorMessages: new SupabaseRealtorMessageStore(db),
    }, request, edit, { now: Date.now(), clientKey: body.clientKey });

    if (!result.ok) return json({ error: result.error, message: result.message }, result.status);
    console.log(`[viewing-request-manage] ${request.ref} ${result.recorded} (whatsapp ${result.whatsapp})`);
    // Never blocks the answer: the change is made whether or not the email goes.
    const emailed = sendIntakeAlert(db, result.alert, env.RESEND_API_KEY);
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(emailed);
    return json({ success: true, recorded: result.recorded, whatsapp: result.whatsapp });
  } catch (e) {
    console.error('[viewing-request-manage] failed:', e);
    return json({ error: 'internal', message: 'Something went wrong on our side. Try again in a moment.' }, 500);
  }
});
