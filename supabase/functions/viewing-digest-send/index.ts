// The weekly digest sweep.
//
// Finds renters who opted in, works out what is new that matches what they
// already shortlisted, and sends one template message each.
//
// **Nothing here can send today, and that is correct.** `weekly_digest` is
// `approved: false` like every other template, so `sendTemplate` refuses before
// writing a row. The sweep still runs: it reports how many renters WOULD have
// been messaged, which is the number worth knowing before asking Meta to
// approve a marketing template, and it means the day approval lands the only
// change is a flag.
//
// The consent rules live in `_shared/viewing/digest.ts` and are pure, so they
// cannot be quietly relaxed by a query in here. This function does I/O and
// obeys.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { sendTemplate, UnapprovedTemplateError, ConsecutiveMessageError } from '../_shared/whatsapp/send.ts';
import { TEMPLATES } from '../_shared/whatsapp/templates.ts';
import {
  assessRenter, digestParams, digestPurpose, newSince,
  type DigestRenter, type Ineligible,
} from '../_shared/viewing/digest.ts';
import type { ShortlistCandidate } from '../_shared/viewing/intake.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CANDIDATE_COLUMNS =
  'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title';

/** One sweep must not message the whole book if something goes wrong. */
const MAX_PER_RUN = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = req.headers.get('x-cron-secret') || '';
  let authorized = token === SERVICE_ROLE;
  if (!authorized && cronSecret) {
    const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
    authorized = data === true;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  // Defaults to a dry run. A sweep that messages every opted-in renter is not
  // something to trigger by curling a URL without meaning to.
  const send = body?.send === true;
  const now = new Date();

  // ── Who opted in ──────────────────────────────────────────────────────────
  const { data: renters, error: renterErr } = await db
    .from('renters')
    .select('id, display_name, opted_out_at, digest_opt_in_at')
    .not('digest_opt_in_at', 'is', null)
    .is('opted_out_at', null)
    .limit(MAX_PER_RUN);
  if (renterErr) return json({ error: renterErr.message }, 500);

  if (!renters?.length) {
    return json({ success: true, opted_in: 0, eligible: 0, sent: 0, note: 'nobody has opted in' });
  }

  // ── What is new this week ─────────────────────────────────────────────────
  // Read once for the whole sweep rather than per renter: at ~25 requests a day
  // the opted-in set is small and the new-listing set is the same for all of
  // them, so one query beats N.
  const { data: fresh } = await db
    .from('external_properties')
    .select(CANDIDATE_COLUMNS)
    .eq('is_active', true)
    .gte('created_at', newSince(now))
    .limit(500);
  const newListings = (fresh ?? []) as ShortlistCandidate[];

  const store = new SupabaseMessageStore(db);
  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  const skipped: Record<Ineligible, number> = {
    OPTED_OUT: 0, NOT_OPTED_IN: 0, NO_HISTORY: 0, NOTHING_NEW: 0,
  };
  let eligible = 0;
  let sent = 0;
  let refused = 0;

  for (const r of renters as DigestRenter[]) {
    // Their own shortlist history is the criteria - they told us what they
    // want by choosing five flats, so there is no form to fill in.
    const { data: items } = await db
      .from('request_items')
      .select('listing_id, viewing_requests!inner(renter_id)')
      .eq('viewing_requests.renter_id', r.id)
      .limit(50);
    const listingIds = [...new Set((items ?? []).map((i: { listing_id: string }) => i.listing_id))];

    let history: ShortlistCandidate[] = [];
    if (listingIds.length > 0) {
      const { data } = await db.from('external_properties').select(CANDIDATE_COLUMNS).in('id', listingIds);
      history = (data ?? []) as ShortlistCandidate[];
    }

    const verdict = assessRenter(r, history, newListings);
    if (!verdict.ok) { skipped[verdict.reason]++; continue; }
    eligible++;

    if (!send) continue;

    try {
      const result = await sendTemplate(store, adapter, {
        renterId: r.id,
        // Pinned to the ISO week, so a retry or a second cron firing cannot
        // produce a second digest. Two in a week is what loses the opt-in.
        purpose: digestPurpose(now),
        templateName: TEMPLATES.WEEKLY_DIGEST.name,
        params: digestParams({ renterName: r.display_name, matches: verdict.matches }),
      });
      if (!result.deduplicated) sent++;
    } catch (e) {
      if (e instanceof UnapprovedTemplateError) {
        // The expected state until Meta approves it. Counted, not logged per
        // renter - 200 identical lines helps nobody.
        refused++;
        continue;
      }
      if (e instanceof ConsecutiveMessageError) { refused++; continue; }
      console.error(`[viewing-digest-send] ${r.id}:`, (e as Error).message);
      refused++;
    }
  }

  const summary = { opted_in: renters.length, eligible, sent, refused, skipped, dry_run: !send };
  if (refused > 0 && sent === 0 && send) {
    console.log(
      `[viewing-digest-send] ${eligible} renter(s) eligible, 0 sent: ` +
      `"${TEMPLATES.WEEKLY_DIGEST.name}" is not approved yet. This is the expected state.`,
    );
  } else {
    console.log(`[viewing-digest-send] ${JSON.stringify(summary)}`);
  }
  return json({ success: true, ...summary });
});
