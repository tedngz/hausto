// One entry point per operation for the agency-feed sources (agency-feeds.ts),
// so scrape-marketplace, verify-external-listings and recrawl-external-listing
// never branch on which agency they are talking to.

import {
  type AgencyFeedSource, type AgencyVerification, type BuildResult, type FeedCandidate,
} from './agency-feeds.ts';
import {
  buildJhouseFromUrl, discoverJhouse, extractJhouseId, verifyJhouse,
} from './jhouse.ts';
import {
  buildRentapartmentFromUrl, discoverRentapartment, extractRentapartmentId, verifyRentapartment,
} from './rentapartment.ts';
import {
  buildVnrenthomeFromUrl, discoverVnrenthome, extractVnrenthomeId, verifyVnrenthome,
} from './vnrenthome.ts';

export { AGENCY_FEED_SOURCES, agencySourceOf, isAgencyFeedSource } from './agency-feeds.ts';
export type { AgencyFeedSource, AgencyListing, FeedCandidate } from './agency-feeds.ts';

interface AgencyAdapter {
  discover: (location?: string) => Promise<FeedCandidate[]>;
  build: (url: string) => Promise<BuildResult>;
  verify: (url: string) => Promise<AgencyVerification>;
  extractId: (url: string) => string | null;
}

// How deep discovery looks is the source's call, not the run's: all are free
// plain fetches, and the run's cap applies only after the listings we already
// hold are dropped. So a run takes whatever is new at the top of the feed
// first, and only once that is all known does it reach back for older units
// still on offer. rentapartment's feed returns 100 a request, vnrenthome's
// index 12 a page, jhouse's API 48 (its ceiling) - three pages of which is
// most of any one district's available stock.
const ADAPTERS: Record<AgencyFeedSource, AgencyAdapter> = {
  rentapartment: {
    discover: (location) => discoverRentapartment(location, 2),
    build: buildRentapartmentFromUrl,
    verify: verifyRentapartment,
    extractId: extractRentapartmentId,
  },
  vnrenthome: {
    discover: (location) => discoverVnrenthome(location, 5),
    build: buildVnrenthomeFromUrl,
    verify: verifyVnrenthome,
    extractId: extractVnrenthomeId,
  },
  jhouse: {
    discover: (location) => discoverJhouse(location, 3),
    build: buildJhouseFromUrl,
    verify: verifyJhouse,
    extractId: extractJhouseId,
  },
};

/** Listing URLs to crawl, best first (agency-feeds.ts `prioritise`). */
export function discoverAgencyListings(source: AgencyFeedSource, location?: string): Promise<FeedCandidate[]> {
  return ADAPTERS[source].discover(location);
}

export function buildAgencyListing(source: AgencyFeedSource, url: string): Promise<BuildResult> {
  return ADAPTERS[source].build(url);
}

export function verifyAgencyListing(source: AgencyFeedSource, url: string): Promise<AgencyVerification> {
  return ADAPTERS[source].verify(url);
}

/** The stable external_id: the agency's own reference ("ra2249", "vr3763"), or jhouse's slug. */
export function extractAgencyListingId(source: AgencyFeedSource, url: string): string | null {
  return ADAPTERS[source].extractId(url);
}
