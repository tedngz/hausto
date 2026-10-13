// A fresh description for a nhatot listing whose price verification has just
// re-read off the ad (a re-price, or a repost brought back from the dead).
//
// The English description was written from the ad as it stood when we first
// stored it. A seller who changes the rent usually rewrites the advert too, so
// the old copy can quote the old rent - and the price cross-check then reads
// our own stale words as the ad contradicting itself, marks the listing LOW,
// and nobody can request it. A renter reading the page sees the same wrong
// figure. So wherever verification takes a new price, it rewrites the
// description from the same payload.
//
// The title stays. Renter messages name a place by its title, and a place
// renamed in the middle of a request is not the one the renter asked for.
//
// The described range is recomputed here, from the title and the new text,
// rather than left to the next cross-check: the row would otherwise sit LOW
// for up to half an hour against a range read from text it no longer has.
import { buildNhatotListing, type NhatotAd } from './nhatot.ts';
import { describedPrice } from './price-mentions.ts';
import type { normalizeListingCopy } from './listing-language.ts';

export interface RepricedCopy {
  description: string;
  described_price_min_vnd: number | null;
  described_price_max_vnd: number | null;
}

/**
 * The columns to write alongside a new price, or null to leave the copy as it
 * is - no advert text on the payload, or the rewrite failed. Never the seller's
 * raw text: an advert body can carry a phone number, and the rewrite is what
 * strips it (invariant 4).
 */
export async function repricedCopy(
  ad: NhatotAd,
  url: string,
  storedTitle: string | null,
  rewrite: typeof normalizeListingCopy,
): Promise<RepricedCopy | null> {
  const built = buildNhatotListing(ad, url);
  if (!built?.description) return null;

  const copy = await rewrite({
    title: built.title,
    description: built.description,
    location: built.location,
    rooms: built.rooms,
    size: built.size,
    fn: 'verify-external-listings',
    sourceUrl: url,
  });
  // `normalizeListingCopy` hands back the original when the model returns no
  // description, which here would be the raw advert.
  if (!copy?.description || copy.description === built.description) return null;

  const range = describedPrice(storedTitle, copy.description);
  return {
    description: copy.description,
    described_price_min_vnd: range?.min_vnd ?? null,
    described_price_max_vnd: range?.max_vnd ?? null,
  };
}
