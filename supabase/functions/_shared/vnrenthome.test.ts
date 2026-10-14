import { describe, it, expect } from 'vitest';
import {
  extractVnrenthomeId, listingJsonLd, parseVnrenthomeDetail, parseVnrenthomeIndex,
  vnrenthomeDistrict, vnrenthomeGallery, vnrenthomeIndexUrl,
} from './vnrenthome.ts';

// Trimmed from the live pages on 2026-10-14: the markup the parser reads is
// kept as the site serves it, long paragraphs and the page chrome are cut.
const card = (id: number, slug: string, status: number, badge: string, price: string) => `
<a aria-label="${slug}" title="Listing ${id}" href="https://vnrenthome.com/v${id}/${slug}.html" target="_blank" class="leading-[1.3] flex flex-col h-full bg-white rounded-lg shadow">
 <div class="relative overflow-hidden"> <img loading="lazy" width="300" height="192" src="https://vnrenthome.com/storage/uploads/2026/10/${id}/photo-1.jpg" alt="x" class="w-full h-48 object-cover" />
 <span class="absolute top-2 right-2 text-white bg-status-${status} text-xs px-2 py-1 rounded-xl"> ${badge} </span> </div>
 <div class="p-4 flex flex-col flex-grow detail"> <p class="text-orange-600 font-bold text-xl mb-3"> ${price} USD <span class="text-xs font-normal text-gray-800">/ month</span> </p>
 <div class="flex items-center gap-1"> <svg/> <span>2 Beds</span> </div> </div> </a>`;

const INDEX = `<form><select aria-label="Sort by" name="sort"><option value="created_at:desc">Newest First</option></select></form>
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-[25px]">
${card(3763, '2-bedroom-luxury-apartment-vinhomes-golden-river-district-1-1136month', 0, 'Check Availability', '1,136')}
${card(3757, '2-bedroom-apartment-for-rent-in-thao-dien-district-2-hcmc-800month', 2, 'Available Soon', '800')}
${card(3756, 'penthouse-for-rent-vinhomes-central-park-binh-thanh-hcmc', 1, 'Available Now', '3,500')}
${card(3755, 'city-garden-binh-thanh-3-bedroom-apartment-for-rent-in-hcmc', 1, 'Available Now', '2,083')}
</div>
<a href="https://vnrenthome.com/listing.html?page=2">2</a>`;

const LD = {
  '@context': 'https://schema.org',
  '@type': 'Apartment',
  name: '2-Bedroom Luxury Apartment Vinhomes Golden River, District 1, $1,136/month',
  description: 'Stunning 2-bed, 2-bath fully furnished apartment at Vinhomes Golden River with river views.',
  image: [
    'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-352.jpg',
    'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-351.jpg',
  ],
  url: 'https://vnrenthome.com/v3763/2-bedroom-luxury-apartment-vinhomes-golden-river-district-1-1136month.html',
  address: { '@type': 'PostalAddress', streetAddress: '02 Ton Duc Thang Street Saigon Ward HCMC', addressCountry: 'VN' },
  offers: { '@type': 'Offer', price: '1136', priceCurrency: 'USD', availability: 'https://schema.org/LimitedAvailability' },
};

const URL_3763 = LD.url;

const detail = (ld: object, typeHref = 'https://vnrenthome.com/apartment-for-rent-in-ho-chi-minh-city/district-1.html', typeText = 'Apartment For Rent in District 1') => `
<head><script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<a href="tel:+84909457542">header</a>
<h1 class="text-xl md:text-3xl font-bold text-black"> 2-Bedroom Luxury Apartment Vinhomes Golden River, District 1, $1,136/month </h1>
<div class="md:flex md:items-center text-black text-sm mt-2 md:flex-wrap"> <strong>Address: </strong> <span class="px-1 py-1">02 Ton Duc Thang Street Saigon Ward HCMC</span> </div>
<div class="text-sm text-black"> <strong>Type:</strong> <a href="${typeHref}" class="hover:text-orange-500 py-1 px-1">${typeText}</a> </div>
<div class="text-orange-500 font-bold text-xl md:text-3xl"> 1,136 USD <span class="text-base">/ month</span> </div>
<div id="prop-3763" class="section-slide w-full" data-gallery-id="prop-3763-gallery"> <div class="swiper-wrapper">
 <div class="swiper-slide"> <img src="https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-353.jpg" alt="x"/> </div>
 <div class="swiper-slide"> <img src="https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-352.jpg" alt="x"/> </div>
 </div>
 <div class="absolute left-3 top-3 z-20 text-white bg-status-0 text-xs px-3 py-1.5 rounded-2xl"> Check Availability </div>
 <div class="hidden"> <a data-fslightbox="prop-3763-gallery" href="https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-353.jpg"></a>
 <a data-fslightbox="prop-3763-gallery" href="https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-352.jpg"></a>
 <a data-fslightbox="prop-3763-gallery" href="https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-348.jpg"></a> </div>
</div>
<div class="w-full bg-white p-6 rounded-lg shadow"> <h2 class="text-xl font-semibold text-black mb-4">Property details</h2> <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
 <div class="flex flex-col items-center gap-1"> <svg/> <span class="text-md text-black"> 2 Bedrooms</span> </div>
 <div class="flex flex-col items-center gap-1"> <svg/> <span class="text-md text-black">2 Bathrooms</span> </div>
 <div class="flex flex-col items-center gap-1"> <svg/> <span class="text-md text-black">27th Floor</span> </div>
 <div class="flex flex-col items-center gap-1"> <svg/> <span class="text-md text-black">Size 69 m2</span> </div>
 <div class="flex flex-col items-center gap-1"> <svg/> <span class="text-md text-black">Pool</span> </div>
 <div class="flex flex-col items-center gap-1"> <svg/> <span class="text-md text-black">Fully Furnished</span> </div>
 <div class="flex flex-col items-center gap-1"> <svg/> <span class="text-md text-black">Security 24/7</span> </div>
</div> </div>
<div class="w-full bg-white p-6 rounded-lg shadow"> <button class="accordion-toggle w-full flex justify-between items-center text-xl font-semibold text-black" > <span>Description</span> <svg/> </button>
<div class="accordion-content text-black single-content-property mt-4"> <h2>2-Bedroom Luxury Apartment, Vinhomes Golden River, District 1</h2>
 <p>This is one of Saigon's most sought-after addresses, and for good reason.</p>
 <p>If you're considering <a href="https://vnrenthome.com/serviced-apartment-ho-chi-minh-city/district-1.html">apartments for rent in District 1</a>, this sits at the premium end of the market.</p>
 <hr class="my-6 border-gray-200"> <p><strong>Ready to find your home in Ho Chi Minh City?</strong></p>
 <p>📞 Call / WhatsApp / Zalo: <strong>+84 909 457 542</strong></p> </div> </div>
<div class="w-full bg-white p-6 rounded-lg shadow"> <button class="accordion-toggle"> <span>Google map</span> </button> </div>
<div class="similar-properties"> <h2 class="text-xl font-semibold text-black mb-4">Similar properties</h2>
 <a href="https://vnrenthome.com/v3760/2-bedroom-apartment-vinhomes-golden-river-district-1-1250month.html"> <img src="https://vnrenthome.com/storage/uploads/2026/10/3760/vinhomes-golden-river-apartment-for-rent-332.jpg" alt="x" /> </a>
 <a href="https://vnrenthome.com/v3749/x.html"> <img src="https://vnrenthome.com/storage/uploads/2026/10/3749/vinhomes-golden-river-apartment-for-rent-293.jpg" alt="x" /> </a>
</div>
<img src="https://vnrenthome.com/storage/uploads/2025/10/p81/masteri-an-phu-thumbnail.webp" alt="project" />
<div class="bg-gradient-to-r from-orange-800 to-orange-700 text-white font-semibold text-lg px-4 py-2"> Agent Details </div>
<div class="p-5 space-y-4"> <img loading="lazy" src="https://vnrenthome.com/storage/avatars/1773627145.jpg" alt="Thomas Dinh">
 <div> <p class="font-bold text-gray-800 text-lg">Thomas Dinh</p> <p class="text-gray-600 text-sm">Senior Property Advisor</p> </div>
 <a title="+84 909 457542" href="tel:+84 909 457542" class="font-medium">+84 909 457542</a> </div>`;

describe('listing URLs', () => {
  it('knows a listing from a project or an article', () => {
    expect(extractVnrenthomeId(URL_3763)).toBe('vr3763');
    expect(extractVnrenthomeId('https://vnrenthome.com/p59/the-river-thu-thiem-apartment-in-ho-chi-minh-city.html')).toBeNull();
    expect(extractVnrenthomeId('https://vnrenthome.com/c1/apartment-hunting-tips-in-hcmc.html')).toBeNull();
    expect(extractVnrenthomeId('https://vnrenthome.com/listing.html?page=2')).toBeNull();
  });

  it('asks the index for newest first, in the rotation district where the site has one', () => {
    expect(vnrenthomeIndexUrl('Quận 1')).toBe('https://vnrenthome.com/listing.html?sort=created_at%3Adesc&location=7');
    expect(vnrenthomeIndexUrl('Thủ Đức', 2)).toBe('https://vnrenthome.com/listing.html?sort=created_at%3Adesc&location=8&page=2');
    expect(vnrenthomeIndexUrl('Gò Vấp')).toBe('https://vnrenthome.com/listing.html?sort=created_at%3Adesc');
  });
});

describe('the index', () => {
  it('reads each card in page order with its availability and price', () => {
    const cards = parseVnrenthomeIndex(INDEX);
    expect(cards.map((c) => [extractVnrenthomeId(c.url), c.availability, c.price])).toEqual([
      ['vr3763', 'UNCONFIRMED', '1,136 USD'],
      ['vr3757', 'AVAILABLE_SOON', '800 USD'],
      ['vr3756', 'AVAILABLE_NOW', '3,500 USD'],
      ['vr3755', 'AVAILABLE_NOW', '2,083 USD'],
    ]);
  });
});

describe('a detail page', () => {
  it('builds the listing from JSON-LD and the details grid', () => {
    const built = parseVnrenthomeDetail(detail(LD), URL_3763);
    expect('listing' in built).toBe(true);
    if (!('listing' in built)) return;
    expect(built.listing).toMatchObject({
      title: '2-Bedroom Luxury Apartment Vinhomes Golden River, District 1, $1,136/month',
      location: '02 Ton Duc Thang Street Saigon Ward, District 1, Ho Chi Minh City',
      price: 28_400_000,
      priceDisplay: '$1,136/month',
      size: '69 m²',
      rooms: '2 Bedrooms',
      amenities: ['Pool', 'Fully Furnished', 'Security 24/7'],
      availability: 'UNCONFIRMED',
      sourceProviderName: 'Thomas Dinh',
      sourceProviderPhone: '+84909457542',
    });
  });

  it("keeps the description and drops the agency's SEO link and sign-off", () => {
    const built = parseVnrenthomeDetail(detail(LD), URL_3763);
    if (!('listing' in built)) throw new Error('not built');
    expect(built.listing.description).toContain("most sought-after addresses");
    expect(built.listing.description).toContain('this sits at the premium end of the market');
    expect(built.listing.description).not.toMatch(/apartments for rent/i);
    expect(built.listing.description).not.toMatch(/Ready to find|WhatsApp|\+84/);
  });

  it("takes the gallery from the listing's own lightbox and JSON-LD - never a similar listing's photo", () => {
    const html = detail(LD);
    const gallery = vnrenthomeGallery(html, URL_3763, listingJsonLd(html));
    expect(gallery).toEqual([
      'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-353.jpg',
      'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-352.jpg',
      'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-348.jpg',
      'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-351.jpg',
    ]);
  });

  it('finds the photos of an older listing, which are not filed under its id', () => {
    // v348, as served: /storage/uploads/products/<area>/<building>/<unit>/.
    const url = 'https://vnrenthome.com/v348/new-pham-viet-chanh-2pn-650usd.html';
    const photo = (n: number) => `https://vnrenthome.com/storage/uploads/products/SA/Binh%20Thanh/New%20Pham%20Viet%20chanh/2pn-650usd-1913/apartment-for-rent-${n}.webp`;
    const html = `<script type="application/ld+json">${JSON.stringify({ ...LD, url, image: [photo(6), photo(15)] })}</script>
      <a data-fslightbox="prop-348-gallery" href="${photo(15)}"></a><a data-fslightbox="prop-348-gallery" href="${photo(2)}"></a>
      <a data-fslightbox="prop-349-gallery" href="${photo(99)}"></a>`;
    expect(vnrenthomeGallery(html, url, listingJsonLd(html))).toEqual([photo(15), photo(2), photo(6)]);
  });

  it('falls back to the id-named directory when a page has no lightbox or JSON-LD', () => {
    const html = detail(LD).replace(/<script[\s\S]*?<\/script>/, '').replace(/data-fslightbox/g, 'data-x');
    expect(vnrenthomeGallery(html, URL_3763, null)).toEqual([
      'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-353.jpg',
      'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-352.jpg',
      'https://vnrenthome.com/storage/uploads/2026/10/3763/vinhomes-golden-river-apartment-for-rent-348.jpg',
    ]);
  });

  it('finds a district wherever the page states one - without it the listing is never shortlistable', () => {
    // The Type link's path, as on v3757 and v3741.
    expect(vnrenthomeDistrict('https://vnrenthome.com/serviced-apartment-ho-chi-minh-city/district-2/thao-dien.html', 'Serviced apartment Thao Dien District 2', '188 Nguyen Van Huong Thao Dien')).toBe('District 2');
    expect(vnrenthomeDistrict('https://vnrenthome.com/apartment-for-rent-in-ho-chi-minh-city/binh-thanh-district.html', 'Apartment For Rent in Binh Thanh District', 'City Garden')).toBe('Binh Thanh District');
    // A city-wide category (v3754's penthouse): the neighbourhood decides.
    expect(vnrenthomeDistrict('https://vnrenthome.com/penthouse-apartment-for-rent-ho-chi-minh-city.html', 'Penthouse Apartment For Rent Ho Chi Minh City', 'Tong Huu Dinh Street Thao Dien')).toBe('District 2');
    expect(vnrenthomeDistrict('https://vnrenthome.com/serviced-apartment-ho-chi-minh-city.html', 'Serviced Apartment Ho Chi Minh City', 'Binh Thanh District')).toBe('');
  });

  it('writes the address the way vn_district_code can read it', () => {
    const at = (street: string, typeHref: string, typeText: string) => {
      const built = parseVnrenthomeDetail(detail({ ...LD, address: { streetAddress: street } }, typeHref, typeText), URL_3763);
      return 'listing' in built ? built.listing.location : built.rejected;
    };
    expect(at('Binh Thanh District - Ho Chi Minh City', 'https://vnrenthome.com/serviced-apartment-ho-chi-minh-city.html', 'Serviced Apartment Ho Chi Minh City'))
      .toBe('Binh Thanh District, Ho Chi Minh City');
    expect(at('Tong Huu Dinh Street Thao Dien HCMC', 'https://vnrenthome.com/penthouse-apartment-for-rent-ho-chi-minh-city.html', 'Penthouse Apartment For Rent Ho Chi Minh City'))
      .toBe('Tong Huu Dinh Street Thao Dien, District 2, Ho Chi Minh City');
    expect(at('Vinhomes Central Park Binh Thanh District HCMC', 'https://vnrenthome.com/penthouse-apartment-for-rent-ho-chi-minh-city.html', 'Penthouse Apartment For Rent Ho Chi Minh City'))
      .toBe('Vinhomes Central Park Binh Thanh District, Ho Chi Minh City');
  });

  it('reads InStock as available now and PreOrder as available soon', () => {
    const soon = parseVnrenthomeDetail(detail({ ...LD, offers: { ...LD.offers, availability: 'https://schema.org/PreOrder' } }), URL_3763);
    expect('listing' in soon && soon.listing.availability).toBe('AVAILABLE_SOON');
    const built = parseVnrenthomeDetail(detail({ ...LD, offers: { ...LD.offers, availability: 'https://schema.org/InStock' } }), URL_3763);
    expect('listing' in built && built.listing.availability).toBe('AVAILABLE_NOW');
  });

  it('refuses a rented unit, a sale and a missing rent', () => {
    expect(parseVnrenthomeDetail(detail({ ...LD, offers: { ...LD.offers, availability: 'https://schema.org/SoldOut' } }), URL_3763))
      .toEqual({ rejected: 'source_rented' });
    expect(parseVnrenthomeDetail(detail(LD, 'https://vnrenthome.com/apartment-for-sale-in-ho-chi-minh-city.html', 'Apartment For Sale in Ho Chi Minh City'), URL_3763))
      .toEqual({ rejected: 'sale_listing' });
    const noPrice = detail({ ...LD, offers: { ...LD.offers, price: '' } }).replace(/text-orange-500[^<]*1,136 USD/, 'text-orange-500"> Contact');
    expect(parseVnrenthomeDetail(noPrice, URL_3763)).toEqual({ rejected: 'no_price' });
  });

  it('survives a page with no JSON-LD, from the visible price and address', () => {
    const built = parseVnrenthomeDetail(detail(LD).replace(/<script[\s\S]*?<\/script>/, ''), URL_3763);
    expect('listing' in built && built.listing.price).toBe(28_400_000);
    expect('listing' in built && built.listing.location).toBe('02 Ton Duc Thang Street Saigon Ward, District 1, Ho Chi Minh City');
  });
});
