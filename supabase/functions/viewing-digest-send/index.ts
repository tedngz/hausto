// The weekly alert sweep: the digest, and complex watches (SPEC §11).
//
// Two sources of "you might want this", one message per renter per week:
//
//   * **The digest.** Renters who opted in (`digest_opt_in_at`) get new
//     listings matched to what they already shortlisted.
//   * **Complex watches.** Renters who sent us a watch code get new listings
//     at that complex that fit the bedrooms and budget they gave.
//
// A renter with both gets one message covering both - the ISO week is the
// idempotency key either way. Up to three places, watches first.
//
// Defaults to a dry run: it reports how many renters WOULD be messaged. The
// cron passes `send: true` (migration 20260928120000), which is what turned
// watches on. The consent rules live in `_shared/viewing/digest.ts` and
// `watch.ts` and are pure, so they cannot be quietly relaxed by a query in
// here. This function does I/O and obeys.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { UnapprovedTemplateError, ConsecutiveMessageError } from '../_shared/whatsapp/send.ts';
import { TEMPLATES } from '../_shared/whatsapp/templates.ts';
import { assessRenter, newSince, type DigestRenter, type Ineligible } from '../_shared/viewing/digest.ts';
import {
  matchesWatch, planAlert,
  type ActiveWatch, type AlertCandidate, type WatchListing,
} from '../_shared/viewing/watch.ts';
import { sendAlert } from '../_shared/viewing/alerts.ts';
import type { ShortlistCandidate } from '../_shared/viewing/intake.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CANDIDATE_COLUMNS =
  'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title, created_at';

/** One sweep must not message the whole book if something goes wrong. */
const MAX_PER_RUN = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type SweepRenter = DigestRenter;
type WatchRow = ActiveWatch & { renter_id: string };

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

  // ── Who asked ─────────────────────────────────────────────────────────────
  const { data: digestRenters, error: renterErr } = await db
    .from('renters')
    .select('id, display_name, opted_out_at, digest_opt_in_at')
    .not('digest_opt_in_at', 'is', null)
    .is('opted_out_at', null)
    .limit(MAX_PER_RUN);
  if (renterErr) return json({ error: renterErr.message }, 500);

  const { data: watchRows, error: watchErr } = await db
    .from('complex_watches')
    .select('id, complex_id, renter_id, bedrooms, budget_max_vnd, confirmed_at')
    .eq('status', 'ACTIVE')
    .gt('expires_at', now.toISOString())
    .not('renter_id', 'is', null)
    .limit(MAX_PER_RUN * 5);
  if (watchErr) return json({ error: watchErr.message }, 500);
  const watches = (watchRows ?? []) as WatchRow[];

  const renters = new Map<string, SweepRenter>();
  for (const r of (digestRenters ?? []) as SweepRenter[]) renters.set(r.id, r);
  const watchOnly = [...new Set(watches.map(w => w.renter_id))].filter(id => !renters.has(id));
  if (watchOnly.length > 0) {
    const { data } = await db
      .from('renters')
      .select('id, display_name, opted_out_at, digest_opt_in_at')
      .in('id', watchOnly)
      .is('opted_out_at', null);
    for (const r of (data ?? []) as SweepRenter[]) renters.set(r.id, r);
  }

  if (renters.size === 0) {
    return json({ success: true, renters: 0, eligible: 0, sent: 0, note: 'nobody has opted in or set a watch' });
  }

  // ── What is new this week ─────────────────────────────────────────────────
  // Read once for the whole sweep rather than per renter: the opted-in set is
  // small and the new-listing set is the same for all of them.
  const { data: fresh } = await db
    .from('external_properties')
    .select(CANDIDATE_COLUMNS)
    .eq('is_active', true)
    .gte('created_at', newSince(now))
    .limit(500);
  const newListings = (fresh ?? []) as WatchListing[];
  const listingById = new Map(newListings.map(l => [l.id, l]));

  // Which of those belong to each watched complex. The match is by name and
  // alias, in SQL (`complex_listing_ids`), and is read once per complex.
  const complexIds = [...new Set(watches.map(w => w.complex_id))];
  const complexName = new Map<string, string>();
  const atComplex = new Map<string, WatchListing[]>();
  if (complexIds.length > 0) {
    const { data: cs } = await db.from('complexes').select('id, name').in('id', complexIds);
    for (const c of (cs ?? []) as { id: string; name: string }[]) complexName.set(c.id, c.name);
  }
  for (const cid of complexIds) {
    const { data: ids, error } = await db.rpc('complex_listing_ids', { _complex_id: cid, _since: newSince(now) });
    if (error) { console.error(`[viewing-digest-send] complex ${cid}:`, error.message); continue; }
    const listingIds = ((ids ?? []) as unknown[]).map(x => (typeof x === 'string' ? x : String((x as Record<string, unknown>).complex_listing_ids)));
    atComplex.set(cid, listingIds.map(id => listingById.get(id)).filter((l): l is WatchListing => !!l));
  }

  // What each renter has already been shown, so nothing is news twice.
  const alerted = new Map<string, Set<string>>();
  const { data: past } = await db
    .from('alert_items')
    .select('renter_id, listing_id')
    .in('renter_id', [...renters.keys()]);
  for (const p of (past ?? []) as { renter_id: string; listing_id: string }[]) {
    if (!alerted.has(p.renter_id)) alerted.set(p.renter_id, new Set());
    alerted.get(p.renter_id)!.add(p.listing_id);
  }

  const store = new SupabaseMessageStore(db);
  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  const skipped: Record<Ineligible | 'NO_MATCH', number> = {
    OPTED_OUT: 0, NOT_OPTED_IN: 0, NO_HISTORY: 0, NOTHING_NEW: 0, NO_MATCH: 0,
  };
  let eligible = 0;
  let sent = 0;
  let refused = 0;
  let viaWatch = 0;

  for (const r of renters.values()) {
    const candidates: AlertCandidate[] = [];

    // Their watches: explicit criteria, at one complex each.
    for (const w of watches.filter(w => w.renter_id === r.id)) {
      for (const l of atComplex.get(w.complex_id) ?? []) {
        if (!matchesWatch(w, l)) continue;
        candidates.push({
          listingId: l.id, title: l.title, priceVnd: l.price_vnd, bedrooms: l.bedrooms,
          source: 'WATCH', watchId: w.id, label: complexName.get(w.complex_id) ?? null,
        });
      }
    }

    // The digest, only for those who opted in to it. Their own shortlist
    // history is the criteria - there is no form to fill in.
    if (r.digest_opt_in_at) {
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
      if (verdict.ok) {
        for (const m of verdict.matches) {
          const l = listingById.get(m.listingId);
          candidates.push({
            listingId: m.listingId, title: m.title, priceVnd: l?.price_vnd ?? null, bedrooms: l?.bedrooms ?? null,
            source: 'DIGEST', watchId: null, label: m.districtCode,
          });
        }
      } else if (candidates.length === 0) {
        skipped[verdict.reason]++;
        continue;
      }
    }

    const plan = planAlert(candidates, alerted.get(r.id) ?? new Set());
    if (plan.length === 0) { skipped.NO_MATCH++; continue; }
    eligible++;
    if (plan.some(p => p.source === 'WATCH')) viaWatch++;

    if (!send) continue;

    try {
      const result = await sendAlert(db, store, adapter, {
        renterId: r.id, renterName: r.display_name, items: plan, now,
      });
      if (result.sent) sent++;
    } catch (e) {
      if (e instanceof UnapprovedTemplateError || e instanceof ConsecutiveMessageError) { refused++; continue; }
      console.error(`[viewing-digest-send] ${r.id}:`, (e as Error).message);
      refused++;
    }
  }

  const summary = {
    renters: renters.size,
    digest_opted_in: (digestRenters ?? []).length,
    active_watches: watches.length,
    eligible, via_watch: viaWatch, sent, refused, skipped, dry_run: !send,
  };
  if (refused > 0 && sent === 0 && send) {
    console.log(
      `[viewing-digest-send] ${eligible} renter(s) eligible, 0 sent - is "${TEMPLATES.WEEKLY_DIGEST.name}" ` +
      'still APPROVED in whatsapp_template_status?',
    );
  }
  console.log(`[viewing-digest-send] ${JSON.stringify(summary)}`);
  return json({ success: true, ...summary });
});
