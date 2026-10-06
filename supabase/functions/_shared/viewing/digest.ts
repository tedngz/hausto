// The new-listing digest (PLAN-v3, the agent's fourth job) - a Pass benefit
// since the pricing rework (SPEC §9, §11): Pass holders who opted in get new
// places that fit them up to twice a week, Tuesday and Friday. Complex watches
// keep their weekly alert on both tiers, on the Tuesday run only.
//
// Unlike the other three, this one is not a reply. Substitutes answer a failed
// request, the search answers a question, a selection answers a list we sent -
// each is a turn in a conversation the renter started. A digest arrives
// unbidden on a Tuesday morning, and that difference decides almost everything
// about how it is built:
//
//   * **It needs its own opt-in**, separate from `opted_out_at`. A renter who
//     asked us to arrange viewings has not asked for a weekly mailshot, and
//     treating the first as consent for the second is how a WhatsApp number
//     gets quality-rated down and eventually limited. `digest_opt_in_at`
//     defaults to NULL and nothing here opts anybody in.
//   * **It is a template**, because a week is longer than the 24-hour window
//     and by definition there is nothing to reply to. That means Meta approval,
//     and it means the template carries a summary rather than the listings -
//     positional parameters cannot hold a variable-length list. The renter
//     replies, which opens the window, and the detail goes free-form after.
//   * **It is almost certainly a Marketing template**, not Utility. That is
//     Meta's call rather than ours, but it changes the billing and the consent
//     bar, and submitting it as Utility to dodge that is the kind of thing that
//     gets a WABA restricted rather than a template rejected.
//
// The criteria are not a form the renter fills in. They already told us what
// they want by shortlisting flats, so the profile comes from their own request
// history - the same `profileOf` the substitute picker uses. A Pass holder with
// no requests yet falls back to their quiz answers (`profileFromQuiz`).

import { profileOf, rankSubstitutes, type RequestProfile } from './substitutes.ts';
import type { ShortlistCandidate } from './intake.ts';
import { districtLabel } from './place.ts';

/** Listings named in one digest. The template summarises; it does not list. */
export const MAX_DIGEST_LISTINGS = 3;

/** A renter with nothing new worth mentioning gets no message at all. */
export const MIN_NEW_LISTINGS = 1;

export interface DigestRenter {
  id: string;
  display_name: string | null;
  opted_out_at: string | null;
  digest_opt_in_at: string | null;
}

export type Ineligible = 'OPTED_OUT' | 'NOT_OPTED_IN' | 'NO_PASS' | 'NO_HISTORY' | 'NOTHING_NEW';

/**
 * The two runs a week. Run 1, Tuesday 09:00, carries the digest and the
 * complex watches; run 2, Friday 09:00, the digest alone. "Up to" twice: a run
 * that finds nothing new sends nothing.
 */
export const DIGEST_RUNS = [1, 2] as const;
export type DigestRun = typeof DIGEST_RUNS[number];

export type Eligibility =
  | { ok: true; profile: RequestProfile; matches: { listingId: string; title: string; districtCode: string | null }[] }
  | { ok: false; reason: Ineligible };

/**
 * Should this renter get a digest this week, and what would be in it?
 *
 * Pure, so the consent rules are testable without a database and cannot be
 * quietly relaxed by a query somewhere else. Every "no" is named, because a
 * digest that silently sends to nobody and a digest that silently sends to
 * everybody look identical from outside.
 */
export function assessRenter(
  renter: DigestRenter,
  shortlistHistory: ShortlistCandidate[],
  newListings: ShortlistCandidate[],
  opts: { hasPass: boolean; quiz?: RequestProfile | null },
): Eligibility {
  // Order matters: a blanket opt-out beats an opt-in, always. A renter who
  // said STOP has said it about everything.
  if (renter.opted_out_at) return { ok: false, reason: 'OPTED_OUT' };
  if (!renter.digest_opt_in_at) return { ok: false, reason: 'NOT_OPTED_IN' };
  // The digest is what the Pass sells: a free renter's opt-in waits for one.
  if (!opts.hasPass) return { ok: false, reason: 'NO_PASS' };
  if (shortlistHistory.length === 0 && !opts.quiz) return { ok: false, reason: 'NO_HISTORY' };

  const profile = shortlistHistory.length > 0 ? profileOf(shortlistHistory) : opts.quiz!;
  // Same ranker as substitutes: it already knows how to exclude what they have
  // seen, hold the price band, and refuse anything intake would reject.
  const ranked = rankSubstitutes(profile, newListings, MAX_DIGEST_LISTINGS);

  if (ranked.length < MIN_NEW_LISTINGS) return { ok: false, reason: 'NOTHING_NEW' };

  return {
    ok: true,
    profile,
    matches: ranked.map(r => ({ listingId: r.listingId, title: r.title, districtCode: r.districtCode })),
  };
}

/**
 * The three template parameters.
 *
 * A template cannot carry a list, so this is a summary that has to be worth
 * interrupting someone for on its own: how many, and where. "3 new places in
 * Thao Dien and District 1" tells a renter whether to open it; "you have new
 * matches" does not.
 */
export function digestParams(opts: {
  renterName: string | null;
  matches: { districtCode: string | null }[];
}): string[] {
  return [
    // Meta rejects a template parameter that is empty, so a renter who never
    // gave a name gets a greeting that still reads as one.
    opts.renterName?.trim() || 'there',
    String(opts.matches.length),
    placeSummary(opts.matches.map(m => m.districtCode && districtLabel(m.districtCode))),
  ];
}

/**
 * `Thao Dien and District 1` - the "where" a template can carry.
 *
 * Shared with the complex-watch alert (watch.ts), which puts complex names in
 * the same slot, so one message covering both reads as one sentence.
 */
export function placeSummary(labels: (string | null)[]): string {
  const places = [...new Set(labels.filter((d): d is string => !!d))];
  return places.length === 0
    ? 'Ho Chi Minh City'
    : places.length === 1
      ? places[0]
      : places.length === 2
        ? `${places[0]} and ${places[1]}`
        : `${places[0]}, ${places[1]} and elsewhere`;
}

/**
 * `2026-W38`. The idempotency key's week component.
 *
 * ISO weeks rather than "seven days since the last one", so a digest is
 * pinned to a calendar week and a retry, a re-run, or a second cron firing
 * cannot produce a second message. Sending the same renter two digests in a
 * week is the failure that loses the opt-in.
 */
export function isoWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO weeks run Monday-Sunday and belong to the year containing their
  // Thursday, which is why this shifts to Thursday before taking the year.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The send purpose, unique per renter per run per calendar week. Run 1 keeps
 * the key it always had, so a week's Tuesday message is never sent twice
 * across the change.
 */
export function digestPurpose(now: Date, run: DigestRun = 1): string {
  return run === 1 ? `DIGEST:${isoWeek(now)}` : `DIGEST:${isoWeek(now)}:${run}`;
}

/**
 * How far back "new" reaches. A week, so a place that came up after Friday's
 * run is still new on Tuesday; nothing is news twice either way, because
 * `alert_items` records what each renter was shown.
 */
export const NEW_SINCE_DAYS = 7;

export function newSince(now: Date): string {
  return new Date(now.getTime() - NEW_SINCE_DAYS * 86_400_000).toISOString();
}


// ── The quiz, for a Pass holder with no requests yet ────────────────────────

/** What the preference quiz recorded (`user_preferences`), as the digest reads it. */
export interface QuizAnswers {
  /** District codes, already mapped from the quiz's place names (vn_district_code). */
  districtCodes: string[];
  priceMinVnd: number | null;
  priceMaxVnd: number | null;
  /** `studio`, `1br`... - one value, or a JSON array of them as the quiz stores it. */
  size: string | null;
}

/** Bedroom counts the quiz's size answer means. A studio is 0, as listings count it. */
export function quizBedrooms(size: string | null): number[] {
  if (!size) return [];
  let values: unknown;
  try { values = JSON.parse(size); } catch { values = size; }
  const list = (Array.isArray(values) ? values : [values]).map(v => String(v).toLowerCase().trim());
  const out = new Set<number>();
  for (const v of list) {
    if (v === 'studio') out.add(0);
    const m = v.match(/^(\d)\s*br/);
    if (m) out.add(Math.min(4, Number(m[1])));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * A profile from the quiz, or null when it says too little to match on - no
 * district and no budget is not a preference, and a digest of whatever is new
 * would be noise. The renter's own range is the price band.
 */
export function profileFromQuiz(q: QuizAnswers): RequestProfile | null {
  const min = q.priceMinVnd && q.priceMinVnd > 0 ? q.priceMinVnd : null;
  const max = q.priceMaxVnd && q.priceMaxVnd > 0 ? q.priceMaxVnd : null;
  if (q.districtCodes.length === 0 && !max) return null;
  return {
    targetPriceVnd: max ? Math.round(((min ?? 0) + max) / 2) : 0,
    districts: [...new Set(q.districtCodes)],
    bedrooms: quizBedrooms(q.size),
    excludeListingIds: [],
    ...(max ? { priceBandVnd: [min ?? 0, max] as [number, number] } : {}),
  };
}

/**
 * The city a quiz place name is in, as `vn_district_code` takes it. The quiz
 * writes "District 1, Ho Chi Minh City", "Tay Ho, Hanoi".
 */
export function quizCity(place: string): 'ho_chi_minh' | 'hanoi' | 'da_nang' | null {
  const p = place.toLowerCase();
  if (/ho chi minh|hcmc|saigon|sai gon/.test(p)) return 'ho_chi_minh';
  if (/ha ?noi/.test(p)) return 'hanoi';
  if (/da ?nang/.test(p)) return 'da_nang';
  return null;
}
