// Picking substitutes when a shortlist comes back empty.
//
// `renderNoSupply` has always taken substitutes, and nothing has ever produced
// any - the ops console passes an empty array. So a zero-confirmed request
// currently tells the renter "we are looking for close matches and will come
// back to you today", and then nobody does. That is a promise the system
// cannot keep, which is worse than the dead end it was meant to avoid.
//
// **Deterministic, not a model.** PLAN-v3 puts substitutes in the agent's
// scope, but the agent's value is parsing natural language, and this is not
// that: it is ranking by district, bedrooms and price, which is arithmetic. An
// LLM call here would cost a line item per failed request from 2026-10-01,
// take a second, and produce a ranking nobody could explain to an operator who
// disagreed with it.
//
// What it will not do is suggest something the renter cannot then request. The
// eligibility gate here is the same one `screenCandidates` applies at intake -
// offering a listing that intake would refuse is a worse failure than offering
// nothing.

import type { ShortlistCandidate } from './intake.ts';

/** PLAN-v3: cap the agent at 3 suggestions per reply. */
export const MAX_SUBSTITUTES = 3;

/**
 * How far from the renter's price a substitute may sit.
 *
 * Asymmetric on purpose. Cheaper is rarely unwelcome, so the floor is
 * generous; dearer is the thing that wasted their time in the first place, so
 * the ceiling is tight. A renter whose 15m shortlist all fell through does not
 * want to hear about 22m flats.
 */
export const PRICE_FLOOR_RATIO = 0.75;
export const PRICE_CEILING_RATIO = 1.15;

export interface RequestProfile {
  /** The middle of what they were actually looking at. */
  targetPriceVnd: number;
  districts: string[];
  bedrooms: number[];
  /** Listing ids already on the shortlist - never suggest these back. */
  excludeListingIds: string[];
  /**
   * The renter's own price range, when they gave one (the quiz, for the
   * digest). Used as the band instead of one drawn around the target.
   */
  priceBandVnd?: [number, number];
}

export interface Substitute {
  listingId: string;
  title: string;
  priceVnd: number;
  districtCode: string | null;
  score: number;
  /** Why it was picked, for the ops console and for debugging a bad pick. */
  reasons: string[];
}

/**
 * What the renter was looking for, inferred from what they shortlisted.
 *
 * The median rather than the mean: one 40m outlier in a shortlist of 15m flats
 * should not drag the target up and turn every suggestion into something they
 * cannot afford.
 */
export function profileOf(shortlisted: ShortlistCandidate[]): RequestProfile {
  const prices = shortlisted.map(c => c.price_vnd).filter((p): p is number => p != null).sort((a, b) => a - b);
  const districts = [...new Set(shortlisted.map(c => c.district_code).filter((d): d is string => !!d))];
  const bedrooms = [...new Set(shortlisted.map(c => c.bedrooms).filter((b): b is number => b != null))];

  return {
    targetPriceVnd: prices.length === 0 ? 0 : prices[Math.floor(prices.length / 2)],
    districts,
    bedrooms,
    excludeListingIds: shortlisted.map(c => c.id),
  };
}

/**
 * Is this candidate one a renter could actually request?
 *
 * Deliberately the same conditions `screenCandidates` enforces at intake. If
 * the two ever drift, the visible symptom is a renter tapping a suggestion and
 * being told it cannot be requested - so they are worth keeping identical even
 * at the cost of the duplication.
 */
export function isOfferable(c: ShortlistCandidate): boolean {
  return !!c.is_active
    && c.price_vnd != null
    && c.price_confidence !== 'LOW'
    && c.bedrooms != null
    && !!c.district_code;
}

/**
 * Rank candidates against the profile.
 *
 * Weights, and why they are ordered this way: a renter who shortlisted five
 * flats in Thao Dien wants Thao Dien. Bedrooms next, because a 1BR is not a
 * substitute for a 3BR at any price. Price last among the three, since
 * everything surviving the band filter is already affordable to them.
 */
export function rankSubstitutes(
  profile: RequestProfile,
  candidates: ShortlistCandidate[],
  limit = MAX_SUBSTITUTES,
): Substitute[] {
  const floor = profile.priceBandVnd?.[0] ?? profile.targetPriceVnd * PRICE_FLOOR_RATIO;
  const ceiling = profile.priceBandVnd?.[1] ?? profile.targetPriceVnd * PRICE_CEILING_RATIO;
  const excluded = new Set(profile.excludeListingIds);

  const scored: Substitute[] = [];

  for (const c of candidates) {
    if (excluded.has(c.id)) continue;
    if (!isOfferable(c)) continue;

    const price = c.price_vnd!;
    // A profile with no price (nothing shortlisted had one) cannot filter on
    // price at all, so the band is skipped rather than rejecting everything.
    if (profile.targetPriceVnd > 0 && (price < floor || price > ceiling)) continue;

    const reasons: string[] = [];
    let score = 0;

    if (c.district_code && profile.districts.includes(c.district_code)) {
      score += 50;
      reasons.push(`same district (${c.district_code})`);
    }
    if (c.bedrooms != null && profile.bedrooms.includes(c.bedrooms)) {
      score += 30;
      reasons.push(`${c.bedrooms} bed, as shortlisted`);
    }
    if (profile.targetPriceVnd > 0) {
      // Closer to the target scores higher, linearly across the band.
      const distance = Math.abs(price - profile.targetPriceVnd) / profile.targetPriceVnd;
      score += Math.max(0, 20 * (1 - distance / PRICE_CEILING_RATIO));
      if (price <= profile.targetPriceVnd) reasons.push('same price or cheaper');
    }

    scored.push({
      listingId: c.id,
      title: c.title ?? 'A place',
      priceVnd: price,
      districtCode: c.district_code,
      score: Math.round(score * 100) / 100,
      reasons,
    });
  }

  // Ties broken by price ascending, then id, so the same inputs always produce
  // the same three - an operator re-reading a request should see what they saw.
  scored.sort((a, b) => b.score - a.score || a.priceVnd - b.priceVnd || a.listingId.localeCompare(b.listingId));

  return scored.slice(0, limit);
}

/** The shape `renderNoSupply` takes. */
export function toRenderable(subs: Substitute[]) {
  return subs.map(s => ({ title: s.title, priceVnd: s.priceVnd, districtCode: s.districtCode }));
}
