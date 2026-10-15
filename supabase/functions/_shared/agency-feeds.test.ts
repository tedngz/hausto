import { describe, it, expect } from 'vitest';
import {
  type FeedCandidate, agencySourceOf, firstTelLink, htmlToText, isAgencyFeedSource,
  parseAmount, prioritise, rentToVnd, roomsLabel,
} from './agency-feeds.ts';

const card = (url: string, availability: FeedCandidate['availability'], postedAt?: string): FeedCandidate =>
  ({ url, availability, postedAt });

describe('crawl order', () => {
  it('takes units available now before soon before unconfirmed', () => {
    const order = prioritise([
      card('https://a/unconfirmed', 'UNCONFIRMED'),
      card('https://a/soon', 'AVAILABLE_SOON'),
      card('https://a/now', 'AVAILABLE_NOW'),
    ]).map((c) => c.url);
    expect(order).toEqual(['https://a/now', 'https://a/soon', 'https://a/unconfirmed']);
  });

  it('takes the newest first within the same availability', () => {
    const order = prioritise([
      card('https://a/june', 'AVAILABLE_NOW', '2026-06-29T05:59:48Z'),
      card('https://a/september', 'AVAILABLE_NOW', '2026-09-21T09:13:31Z'),
      card('https://a/august', 'AVAILABLE_NOW', '2026-08-01T00:00:00Z'),
    ]).map((c) => c.url);
    expect(order).toEqual(['https://a/september', 'https://a/august', 'https://a/june']);
  });

  it("keeps the feed's own order where it gives no date - both feeds are asked for newest first", () => {
    const order = prioritise([
      card('https://a/v3763', 'UNCONFIRMED'),
      card('https://a/v3762', 'UNCONFIRMED'),
      card('https://a/v3756', 'AVAILABLE_NOW'),
      card('https://a/v3755', 'AVAILABLE_NOW'),
    ]).map((c) => c.url);
    expect(order).toEqual(['https://a/v3756', 'https://a/v3755', 'https://a/v3763', 'https://a/v3762']);
  });

  it('drops rented units and repeats', () => {
    const order = prioritise([
      card('https://a/1', 'RENTED'),
      card('https://a/2', 'AVAILABLE_NOW'),
      card('https://a/2', 'UNCONFIRMED'),
    ]).map((c) => c.url);
    expect(order).toEqual(['https://a/2']);
  });
});

describe('rent', () => {
  it('converts the dollars both agencies quote, at the rate canonical_price_vnd uses', () => {
    expect(rentToVnd(540)).toEqual({ price: 13_500_000, priceDisplay: '$540/month' });
    expect(rentToVnd(1136)).toEqual({ price: 28_400_000, priceDisplay: '$1,136/month' });
  });

  it('leaves a figure that is already dong alone', () => {
    expect(rentToVnd(15_000_000)).toEqual({ price: 15_000_000, priceDisplay: '15.000.000 ₫/month' });
    expect(rentToVnd(15_000_000, 'VND').price).toBe(15_000_000);
  });

  it('refuses no rent at all', () => {
    expect(rentToVnd(0)).toBeNull();
    expect(rentToVnd(NaN)).toBeNull();
  });

  it('reads printed amounts', () => {
    expect(parseAmount('1,136')).toBe(1136);
    expect(parseAmount('1136.00')).toBe(1136);
    expect(parseAmount('$ 3,500 USD')).toBe(3500);
    expect(parseAmount('12,500,000')).toBe(12_500_000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe('rooms', () => {
  it('labels bedrooms the way parse_bedrooms reads them', () => {
    expect(roomsLabel(1)).toBe('1 Bedroom');
    expect(roomsLabel(3)).toBe('3 Bedrooms');
    expect(roomsLabel(5)).toBe('4+ Bedrooms');
    expect(roomsLabel(0)).toBe('Studio');
    expect(roomsLabel(null)).toBe('');
  });

  it('calls a one-bed studio a studio', () => {
    expect(roomsLabel(1, true)).toBe('Studio');
    expect(roomsLabel(2, true)).toBe('2 Bedrooms');
  });
});

describe('page text', () => {
  it('reads the number printed on the ad', () => {
    expect(firstTelLink('<a href="tel:+84 909 457542">call</a>')).toBe('+84909457542');
    expect(firstTelLink('<a href="tel:+84903044551">')).toBe('+84903044551');
    expect(firstTelLink('<a href="mailto:x@y">')).toBeNull();
  });

  it('reads from a starting point, so the agent block wins over the header', () => {
    const html = '<a href="tel:0900000000">site</a> Agent Details <a href="tel:0911111111">agent</a>';
    expect(firstTelLink(html, html.indexOf('Agent Details'))).toBe('0911111111');
  });

  it('turns WordPress content into paragraphs', () => {
    const text = htmlToText('<p class="wp-block-paragraph">Quiet street &#8211; near D1.</p>\n\n<ul><li>Electricity: 4,000 vnd/kWh</li></ul>');
    expect(text).toBe('Quiet street - near D1.\n\n- Electricity: 4,000 vnd/kWh');
  });
});

describe('source names', () => {
  it('knows every agency, by source or by URL', () => {
    expect(isAgencyFeedSource('rentapartment')).toBe(true);
    expect(isAgencyFeedSource('vnrenthome')).toBe(true);
    expect(isAgencyFeedSource('jhouse')).toBe(true);
    expect(agencySourceOf('', 'https://jhouse.vn/property/rome-apartment-thao-dien-1-bedroom-a603')).toBe('jhouse');
    expect(isAgencyFeedSource('housingsgn')).toBe(false);
    expect(agencySourceOf('', 'https://vnrenthome.com/v3763/x.html')).toBe('vnrenthome');
    expect(agencySourceOf('rentapartment')).toBe('rentapartment');
    expect(agencySourceOf('nhatot', 'https://www.nhatot.com/1.htm')).toBeNull();
  });
});
