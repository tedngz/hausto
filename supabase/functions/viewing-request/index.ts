// Request intake. The renter-facing write path, so it is the one place a
// stranger's input reaches the viewing tables - everything is validated here
// and nothing is trusted from the client.
//
// Creates the renter, the request, its items and the opening events, in that
// order, and returns the ref plus a wa.me deep link carrying it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WA_NUMBER = Deno.env.get('WHATSAPP_BUSINESS_NUMBER') || '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function toE164(raw: string): string | null {
  const d = String(raw ?? '').replace(/[^0-9+]/g, '');
  if (/^\+84[0-9]{9}$/.test(d)) return d;
  if (/^84[0-9]{9}$/.test(d)) return `+${d}`;
  if (/^0[0-9]{9}$/.test(d)) return `+84${d.slice(1)}`;
  return null;
}

// No I, O, 0 or 1 - the ref gets read down a phone line and spelled back.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return 'HV-' + [...bytes].map(b => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  let body: { phone?: string; name?: string; listingIds?: string[]; availability?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const phone = toE164(body.phone ?? '');
  if (!phone) return json({ error: 'invalid_phone', message: 'Enter a Vietnamese mobile number.' }, 400);

  const listingIds = [...new Set(body.listingIds ?? [])];
  // Three to five is the product, not a guess: fewer is not worth an operator's
  // round of calls, more than five cannot be seen in a day.
  if (listingIds.length < 3 || listingIds.length > 5) {
    return json({ error: 'bad_shortlist', message: 'Choose between 3 and 5 places.' }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Every listing must be one we would actually put in front of an operator.
  // The client sends ids; it does not get to decide what is eligible.
  const { data: listings, error: listErr } = await db
    .from('external_properties')
    .select('id, price_vnd, is_active, price_confidence, bedrooms, area_sqm, district_code, realtor_id')
    .in('id', listingIds);
  if (listErr) return json({ error: 'lookup_failed', message: listErr.message }, 500);

  const eligible = (listings ?? []).filter(l =>
    l.is_active && l.price_vnd && l.price_confidence === 'HIGH' &&
    l.bedrooms !== null && l.area_sqm !== null && l.district_code !== null);

  if (eligible.length !== listingIds.length) {
    return json({
      error: 'listing_unavailable',
      message: 'One of these is no longer available. Refresh and choose again.',
      eligible: eligible.map(l => l.id),
    }, 409);
  }

  // Renter, found or created.
  let renterId: string;
  const { data: existingRenter } = await db
    .from('renters').select('id, opted_out_at').eq('phone_e164', phone).maybeSingle();
  if (existingRenter) {
    if (existingRenter.opted_out_at) {
      return json({ error: 'opted_out', message: 'This number has opted out of messages.' }, 403);
    }
    renterId = existingRenter.id;
    if (body.name) await db.from('renters').update({ display_name: body.name }).eq('id', renterId);
  } else {
    const { data: created, error } = await db
      .from('renters').insert({ phone_e164: phone, display_name: body.name ?? null }).select('id').single();
    if (error) return json({ error: 'renter_failed', message: error.message }, 500);
    renterId = created.id;
  }

  // Request. `ref` is unique, so a collision is an error rather than a silent
  // overwrite - retried a few times because 32^4 is small enough to collide.
  let request: { id: string; ref: string } | null = null;
  for (let attempt = 0; attempt < 5 && !request; attempt++) {
    const ref = newRef();
    const { data, error } = await db
      .from('viewing_requests')
      .insert({ ref, renter_id: renterId, availability: body.availability ?? {} })
      .select('id, ref')
      .single();
    if (!error) { request = data; break; }
    if (error.code !== '23505') return json({ error: 'request_failed', message: error.message }, 500);
  }
  if (!request) return json({ error: 'ref_collision', message: 'Could not allocate a reference.' }, 500);

  // Items, carrying the price the renter was shown. That is what makes "the
  // broker quoted something else" a comparison later rather than an argument.
  const items = eligible.map((l, i) => ({
    request_id: request!.id,
    listing_id: l.id,
    realtor_id: l.realtor_id ?? null,
    price_vnd_at_request: l.price_vnd,
    sort_order: i,
  }));
  const { data: insertedItems, error: itemErr } = await db
    .from('request_items').insert(items).select('id, listing_id, realtor_id, price_vnd_at_request');
  if (itemErr) return json({ error: 'items_failed', message: itemErr.message }, 500);

  // Events last, and as one insert. Status is derived from these, so a request
  // whose items exist but whose events do not would reduce to DRAFT - visible
  // as a bug rather than silently wrong, which is the point of deriving it.
  const events: Record<string, unknown>[] = [
    { request_id: request.id, type: 'REQUEST_SUBMITTED', actor: 'RENTER', payload: { availability: body.availability ?? {} } },
  ];
  for (const it of insertedItems ?? []) {
    events.push({
      request_id: request.id,
      item_id: it.id,
      type: 'ITEM_ADDED',
      actor: 'RENTER',
      payload: { listing_id: it.listing_id, price_vnd_at_request: it.price_vnd_at_request },
    });
    if (it.realtor_id) {
      events.push({
        request_id: request.id,
        item_id: it.id,
        type: 'REALTOR_RESOLVED',
        actor: 'SYSTEM',
        payload: { realtor_id: it.realtor_id, method: 'INGEST' },
      });
    }
  }
  const { error: evErr } = await db.from('events').insert(events);
  if (evErr) return json({ error: 'events_failed', message: evErr.message }, 500);

  const unresolved = (insertedItems ?? []).filter(i => !i.realtor_id).length;

  return json({
    success: true,
    ref: request.ref,
    requestId: request.id,
    itemCount: insertedItems?.length ?? 0,
    // Not a failure. Ops resolves these on demand, and every resolution
    // enriches the realtor table permanently.
    unresolvedRealtors: unresolved,
    waLink: WA_NUMBER
      ? `https://wa.me/${WA_NUMBER.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi, my viewing request is ${request.ref}`)}`
      : null,
  });
});
