// The alert sweep: the digest, and complex watches (SPEC §11). The I/O around
// the pure rules in digest.ts and watch.ts, shared by `viewing-digest-send`
// and the tests, so the cron and the rehearsal run the same code.
//
// Two sources of "you might want this", one message per renter per run:
//
//   * **The digest** - a Pass benefit since the pricing rework. Pass holders
//     who opted in (`digest_opt_in_at`) get new listings matched to what they
//     already shortlisted, or to their quiz answers if they have shortlisted
//     nothing yet. Twice a week: run 1 on Tuesday, run 2 on Friday.
//   * **Complex watches**, on both tiers. Renters who sent us a watch code get
//     new listings at that complex that fit the bedrooms and budget they gave
//     - weekly, on run 1 only.
//
// A renter with both gets one message covering both. Up to three places,
// watches first.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import type { MessageStore } from '../whatsapp/send.ts';
import { UnapprovedTemplateError, ConsecutiveMessageError } from '../whatsapp/send.ts';
import { marketingHold, readNumberStatus } from '../whatsapp/number-health.ts';
import {
  assessRenter, newSince, profileFromQuiz, quizCity,
  type DigestRenter, type DigestRun, type Ineligible,
} from './digest.ts';
import type { RequestProfile } from './substitutes.ts';
import { matchesWatch, planAlert, type ActiveWatch, type AlertCandidate, type WatchListing } from './watch.ts';
import { sendAlert } from './alerts.ts';
import { districtLabel } from './place.ts';
import { hasPassCover } from './lock-in-run.ts';
import type { ShortlistCandidate } from './intake.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

const CANDIDATE_COLUMNS =
  'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title, created_at';

/** One sweep must not message the whole book if something goes wrong. */
export const MAX_PER_RUN = 200;

type SweepRenter = DigestRenter & { user_id?: string | null };
type WatchRow = ActiveWatch & { renter_id: string };

export interface SweepSummary {
  run: DigestRun;
  renters: number;
  digest_opted_in: number;
  active_watches: number;
  eligible: number;
  via_watch: number;
  sent: number;
  refused: number;
  held: number;
  skipped: Record<Ineligible | 'NO_MATCH', number>;
  dry_run: boolean;
  /**
   * What is wrong with the number, when something is (number-health.ts). While
   * it is set, a run asked to send runs dry.
   */
  quality_hold: string | null;
}

/** A Pass holder's quiz answers as a profile, with place names mapped to district codes. */
async function quizProfile(db: Supa, userId: string): Promise<RequestProfile | null> {
  const { data: prefs } = await db
    .from('user_preferences')
    .select('location, price_range_min, price_range_max, size')
    .eq('user_id', userId)
    .maybeSingle();
  if (!prefs) return null;
  const places = Array.isArray(prefs.location) ? (prefs.location as string[]) : [];
  const codes: string[] = [];
  for (const place of places) {
    const city = quizCity(place);
    if (!city) continue;
    const { data: code } = await db.rpc('vn_district_code', { _city: city, _location: place });
    if (typeof code === 'string' && code) codes.push(code);
  }
  return profileFromQuiz({
    districtCodes: codes,
    priceMinVnd: prefs.price_range_min != null ? Number(prefs.price_range_min) : null,
    priceMaxVnd: prefs.price_range_max != null ? Number(prefs.price_range_max) : null,
    size: (prefs.size as string | null) ?? null,
  });
}

export async function runDigestSweep(
  db: Supa,
  store: MessageStore,
  adapter: WhatsAppAdapter,
  opts: { run: DigestRun; send: boolean; now: Date },
): Promise<SweepSummary> {
  const { run, now } = opts;

  // ── The number first ──────────────────────────────────────────────────────
  // The digest is marketing, and marketing is what lowers a number's rating -
  // the number every itinerary goes out from. While Meta's last reading says
  // anything is wrong, a run asked to send runs dry instead and says why.
  const qualityHold = marketingHold(await readNumberStatus(db));
  const send = opts.send && !qualityHold;
  if (opts.send && qualityHold) console.warn(`[digest-sweep] run ${run} held: ${qualityHold}`);

  // ── Who asked ─────────────────────────────────────────────────────────────
  const { data: digestRenters, error: renterErr } = await db
    .from('renters')
    .select('id, user_id, display_name, opted_out_at, digest_opt_in_at')
    .not('digest_opt_in_at', 'is', null)
    .is('opted_out_at', null)
    .limit(MAX_PER_RUN);
  if (renterErr) throw new Error(renterErr.message);

  // Watches are weekly: Tuesday's run only.
  let watches: WatchRow[] = [];
  if (run === 1) {
    const { data: watchRows, error: watchErr } = await db
      .from('complex_watches')
      .select('id, complex_id, area_district_codes, area_label, renter_id, bedrooms, budget_max_vnd, confirmed_at')
      .eq('status', 'ACTIVE')
      .gt('expires_at', now.toISOString())
      .not('renter_id', 'is', null)
      .limit(MAX_PER_RUN * 5);
    if (watchErr) throw new Error(watchErr.message);
    watches = (watchRows ?? []) as WatchRow[];
  }

  const renters = new Map<string, SweepRenter>();
  for (const r of (digestRenters ?? []) as SweepRenter[]) renters.set(r.id, r);
  const watchOnly = [...new Set(watches.map(w => w.renter_id))].filter(id => !renters.has(id));
  if (watchOnly.length > 0) {
    const { data } = await db
      .from('renters')
      .select('id, user_id, display_name, opted_out_at, digest_opt_in_at')
      .in('id', watchOnly)
      .is('opted_out_at', null);
    for (const r of (data ?? []) as SweepRenter[]) renters.set(r.id, r);
  }

  const skipped: SweepSummary['skipped'] = {
    OPTED_OUT: 0, NOT_OPTED_IN: 0, NO_PASS: 0, NO_HISTORY: 0, NOTHING_NEW: 0, NO_MATCH: 0,
  };
  const summary: SweepSummary = {
    run, renters: renters.size, digest_opted_in: (digestRenters ?? []).length, active_watches: watches.length,
    eligible: 0, via_watch: 0, sent: 0, refused: 0, held: 0, skipped, dry_run: !send,
    quality_hold: qualityHold,
  };
  if (renters.size === 0) return summary;

  // ── What is new ───────────────────────────────────────────────────────────
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
  const complexIds = [...new Set(watches.map(w => w.complex_id).filter((c): c is string => !!c))];
  const complexName = new Map<string, string>();
  const atComplex = new Map<string, WatchListing[]>();
  if (complexIds.length > 0) {
    const { data: cs } = await db.from('complexes').select('id, name').in('id', complexIds);
    for (const c of (cs ?? []) as { id: string; name: string }[]) complexName.set(c.id, c.name);
  }
  for (const cid of complexIds) {
    const { data: ids, error } = await db.rpc('complex_listing_ids', { _complex_id: cid, _since: newSince(now) });
    if (error) { console.error(`[digest-sweep] complex ${cid}:`, error.message); continue; }
    const listingIds = ((ids ?? []) as unknown[]).map(x => (typeof x === 'string' ? x : String((x as Record<string, unknown>).complex_listing_ids)));
    atComplex.set(cid, listingIds.map(id => listingById.get(id)).filter((l): l is WatchListing => !!l));
  }

  // What each renter has already been shown, so nothing is news twice -
  // across runs too: Friday's never repeats Tuesday's.
  const alerted = new Map<string, Set<string>>();
  const { data: past } = await db
    .from('alert_items')
    .select('renter_id, listing_id')
    .in('renter_id', [...renters.keys()]);
  for (const p of (past ?? []) as { renter_id: string; listing_id: string }[]) {
    if (!alerted.has(p.renter_id)) alerted.set(p.renter_id, new Set());
    alerted.get(p.renter_id)!.add(p.listing_id);
  }

  for (const r of renters.values()) {
    const candidates: AlertCandidate[] = [];

    // Their watches: explicit criteria, at one complex each.
    for (const w of watches.filter(w => w.renter_id === r.id)) {
      // A building's new listings, or an area's (Priority search): in its districts.
      const pool = w.complex_id
        ? atComplex.get(w.complex_id) ?? []
        : newListings.filter(l => !!l.district_code && (w.area_district_codes ?? []).includes(l.district_code));
      for (const l of pool) {
        if (!matchesWatch(w, l)) continue;
        candidates.push({
          listingId: l.id, title: l.title, priceVnd: l.price_vnd, bedrooms: l.bedrooms,
          source: 'WATCH', watchId: w.id,
          // A search's place is the district it is in, in words: "District 2".
          label: w.complex_id ? complexName.get(w.complex_id) ?? null : l.district_code ? districtLabel(l.district_code) : null,
        });
      }
    }

    // The digest, only for Pass holders who opted in to it. Their own
    // shortlist history is the criteria - or, with none yet, their quiz.
    if (r.digest_opt_in_at) {
      const hasPass = await hasPassCover(db, r.user_id ?? null);
      let history: ShortlistCandidate[] = [];
      let quiz: RequestProfile | null = null;
      if (hasPass) {
        const { data: items } = await db
          .from('request_items')
          .select('listing_id, viewing_requests!inner(renter_id)')
          .eq('viewing_requests.renter_id', r.id)
          .limit(50);
        const listingIds = [...new Set(((items ?? []) as { listing_id: string }[]).map(i => i.listing_id))];
        if (listingIds.length > 0) {
          const { data } = await db.from('external_properties').select(CANDIDATE_COLUMNS).in('id', listingIds);
          history = (data ?? []) as ShortlistCandidate[];
        }
        if (history.length === 0 && r.user_id) quiz = await quizProfile(db, r.user_id);
      }
      const verdict = assessRenter(r, history, newListings, { hasPass, quiz });
      if (verdict.ok) {
        for (const m of verdict.matches) {
          const l = listingById.get(m.listingId);
          candidates.push({
            listingId: m.listingId, title: m.title, priceVnd: l?.price_vnd ?? null, bedrooms: l?.bedrooms ?? null,
            source: 'DIGEST', watchId: null, label: m.districtCode ? districtLabel(m.districtCode) : null,
          });
        }
      } else if (candidates.length === 0) {
        skipped[verdict.reason]++;
        continue;
      }
    }

    const plan = planAlert(candidates, alerted.get(r.id) ?? new Set());
    if (plan.length === 0) { skipped.NO_MATCH++; continue; }
    summary.eligible++;
    if (plan.some(p => p.source === 'WATCH')) summary.via_watch++;

    if (!send) continue;

    try {
      const result = await sendAlert(db, store, adapter, {
        renterId: r.id, renterName: r.display_name, items: plan, now, run,
      });
      if (result.sent) summary.sent++;
      // An itinerary is waiting for their yes; the next run tries again.
      if (result.held) summary.held++;
    } catch (e) {
      if (e instanceof UnapprovedTemplateError || e instanceof ConsecutiveMessageError) { summary.refused++; continue; }
      console.error(`[digest-sweep] ${r.id}:`, (e as Error).message);
      summary.refused++;
    }
  }

  return summary;
}
