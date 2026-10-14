// One entry point per operation for the agency-feed sources (agency-feeds.ts),
// so scrape-marketplace, verify-external-listings and recrawl-external-listing
// never branch on which agency they are talking to.

import {
  type AgencyFeedSource, type AgencyVerification, type BuildResult, type FeedCandidate,
} from './agency-feeds.ts';
import {
  buildRentapartmentFromUrl, discoverRentapartment, extractRentapartmentId, verifyRentapartment,
} from './rentapartment.ts';
import {
  buildVnrenthomeFromUrl, discoverVnrenthome, extractVnrenthomeId, verifyVnrenthome,
} from './vnrenthome.ts';

export { AGENCY_FEED_SOURCES, agencySourceOf, isAgencyFeedSource } from './agency-feeds.ts';
export type { AgencyFeedSource, AgencyListing, FeedCandidate } from './agency-feeds.ts';

/**
 * Listing URLs to crawl, best first (agency-feeds.ts `prioritise`).
 *
 * How deep to look is the source's call, not the run's: both are free plain
 * fetches, and the run's cap applies only after the listings we already hold
 * are dropped. So a run takes whatever is new at the top of the feed first,
 * and only once that is all known does it reach back for older units still on
 * offer. rentapartment's feed returns 100 a request; vnrenthome's index 12 a
 * page.
 */
export function discoverAgencyListings(source: AgencyFeedSource, location?: string): Promise<FeedCandidate[]> {
  return source === 'rentapartment' ? discoverRentapartment(location, 2) : discoverVnrenthome(location, 5);
}

export function buildAgencyListing(source: AgencyFeedSource, url: string): Promise<BuildResult> {
  return source === 'rentapartment' ? buildRentapartmentFromUrl(url) : buildVnrenthomeFromUrl(url);
}

export function verifyAgencyListing(source: AgencyFeedSource, url: string): Promise<AgencyVerification> {
  return source === 'rentapartment' ? verifyRentapartment(url) : verifyVnrenthome(url);
}

/** The stable external_id: the agency's own reference ("ra2249", "vr3763"). */
export function extractAgencyListingId(source: AgencyFeedSource, url: string): string | null {
  return source === 'rentapartment' ? extractRentapartmentId(url) : extractVnrenthomeId(url);
}
