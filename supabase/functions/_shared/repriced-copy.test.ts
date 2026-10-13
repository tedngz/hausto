import { describe, it, expect, vi } from 'vitest';
import { repricedCopy } from './repriced-copy.ts';
import type { normalizeListingCopy } from './listing-language.ts';

const M = 1_000_000;
const URL = 'https://www.nhatot.com/thue-can-ho-chung-cu-quan-3-tp-ho-chi-minh/93347687.htm';

// The Terra Royal ad as it reads after the seller re-priced it: 18tr, where the
// description we wrote from the earlier advert still said 15 million.
const ad = {
  subject: 'Terra Royal 2PN=18Tr - 3PN 25Tr Xem nhiều căn',
  price: 18 * M,
  price_string: '18 triệu/tháng',
  rooms: 2,
  size: 58,
  area_name: 'Quận 3',
  region_name: 'Tp Hồ Chí Minh',
  body: 'Diện Tích ( 58 m2 ): 2 Phòng ngủ, 1 Toilet, Nội thất cơ bản. GIÁ THUÊ: 18 Triệu / Tháng\n☎️ Liên hệ xem căn hộ *** Tony (Zalo/Phone)',
};

const STORED_TITLE = 'Rent a Beautiful 2 Bedroom Apartment at Terra Royal, District 3, Ho Chi Minh City';
const FRESH = 'A bright 58 m² two-bedroom in Terra Royal with curtains, air conditioning and a fitted kitchen. The building has a gym, a pool and a cinema.';

const rewriter = (description: string | null) =>
  vi.fn<typeof normalizeListingCopy>(async () =>
    description == null ? null : { title: 'Ignored', description, amenities: [] });

describe('repricedCopy', () => {
  it('rewrites the description from the ad it took the new price from', async () => {
    const rewrite = rewriter(FRESH);
    expect(await repricedCopy(ad, URL, STORED_TITLE, rewrite)).toEqual({
      description: FRESH,
      described_price_min_vnd: null,
      described_price_max_vnd: null,
    });
    // The seller's text and figures go in; the model never sees the old copy.
    expect(rewrite).toHaveBeenCalledWith(expect.objectContaining({
      title: ad.subject,
      description: ad.body,
      rooms: '2 Bedrooms',
      size: '58 m²',
    }));
  });

  it('reads the range from the stored title and the new text, which the title is kept beside', async () => {
    const got = await repricedCopy(ad, URL, 'Terra Royal 2PN 18tr', rewriter(FRESH));
    expect(got).toMatchObject({ described_price_min_vnd: 18 * M, described_price_max_vnd: 18 * M });
  });

  it('keeps a rent the rewrite quotes, since it comes from the current ad', async () => {
    const got = await repricedCopy(ad, URL, STORED_TITLE, rewriter('Two bedrooms in Terra Royal, 18 million VND per month.'));
    expect(got).toMatchObject({ described_price_min_vnd: 18 * M, described_price_max_vnd: 18 * M });
  });

  it('leaves the copy alone when the rewrite fails', async () => {
    expect(await repricedCopy(ad, URL, STORED_TITLE, rewriter(null))).toBeNull();
  });

  it('never stores the raw advert, which the rewriter falls back to', async () => {
    expect(await repricedCopy(ad, URL, STORED_TITLE, rewriter(ad.body.trim()))).toBeNull();
  });

  it('does not call the model for an ad with no text', async () => {
    const rewrite = rewriter(FRESH);
    expect(await repricedCopy({ ...ad, body: '' }, URL, STORED_TITLE, rewrite)).toBeNull();
    expect(rewrite).not.toHaveBeenCalled();
  });
});
