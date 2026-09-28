// The weekly new-listing digest (PLAN-v3, the agent's fourth job).
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
// they want by shortlisting five flats, so the profile comes from their own
// request history - the same `profileOf` the substitute picker uses.

import { profileOf, rankSubstitutes, type RequestProfile } from './substitutes.ts';
import type { ShortlistCandidate } from './intake.ts';

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

export type Ineligible = 'OPTED_OUT' | 'NOT_OPTED_IN' | 'NO_HISTORY' | 'NOTHING_NEW';

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
): Eligibility {
  // Order matters: a blanket opt-out beats an opt-in, always. A renter who
  // said STOP has said it about everything.
  if (renter.opted_out_at) return { ok: false, reason: 'OPTED_OUT' };
  if (!renter.digest_opt_in_at) return { ok: false, reason: 'NOT_OPTED_IN' };
  if (shortlistHistory.length === 0) return { ok: false, reason: 'NO_HISTORY' };

  const profile = profileOf(shortlistHistory);
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
    placeSummary(opts.matches.map(m => m.districtCode)),
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

/** The send purpose, unique per renter per calendar week. */
export function digestPurpose(now: Date): string {
  return `DIGEST:${isoWeek(now)}`;
}

/** How far back "new" reaches. A week, matching the cadence. */
export const NEW_SINCE_DAYS = 7;

export function newSince(now: Date): string {
  return new Date(now.getTime() - NEW_SINCE_DAYS * 86_400_000).toISOString();
}
