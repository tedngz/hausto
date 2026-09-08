// City detection and coverage scope, shared by every crawler path.
//
// This lived as a copy-pasted function in scrape-marketplace and
// scheduled-crawl. Both copies were missing the accented spelling of Ho Chi
// Minh City, so "Hồ Chí Minh" - the form batdongsan and nhatot actually print -
// resolved to 'other'. That mattered twice over: the row was stored with
// city='other', and the cross-city filter only rejects a listing whose city it
// recognises, so anything it failed to place went straight through. That is how
// Nha Trang, Bình Dương and Hải Phòng listings reached the feed.

export type City = 'ho_chi_minh' | 'hanoi' | 'da_nang' | 'other';

// Cities Hausto covers. A listing has to resolve to one of these to be stored.
export const SUPPORTED_CITIES: City[] = ['ho_chi_minh', 'hanoi', 'da_nang'];

const HO_CHI_MINH = /(hồ chí minh|ho chi minh|tphcm|tp\.?\s?hcm|hcmc?\b|saigon|sài gòn|thủ đức|thu duc|quận\s?\d{1,2}|quan\s?\d{1,2}|district\s?\d{1,2}|bình thạnh|binh thanh|phú nhuận|phu nhuan|tân bình|tan binh|gò vấp|go vap|tân phú|tan phu|bình tân|binh tan|bình chánh|binh chanh|nhà bè|nha be|hóc môn|hoc mon|củ chi|cu chi|cần giờ|can gio)/i;
const HANOI = /(hà nội|ha noi|hanoi|ba đình|ba dinh|hoàn kiếm|hoan kiem|đống đa|dong da|cầu giấy|cau giay|hai bà trưng|hai ba trung|tây hồ|tay ho|long biên|long bien|thanh xuân|thanh xuan|hoàng mai|hoang mai|bắc từ liêm|bac tu liem|nam từ liêm|nam tu liem|hà đông|ha dong|gia lâm|gia lam|đông anh|dong anh|sóc sơn|soc son|thanh trì|thanh tri|hoài đức|hoai duc|mê linh|me linh|sơn tây|son tay)/i;
const DA_NANG = /(đà nẵng|da nang|danang|hải châu|hai chau|thanh khê|thanh khe|sơn trà|son tra|ngũ hành sơn|ngu hanh son|liên chiểu|lien chieu|cẩm lệ|cam le|hòa vang|hoa vang)/i;

export function detectCity(location: string): City {
  const lower = (location || '').toLowerCase();
  if (HO_CHI_MINH.test(lower)) return 'ho_chi_minh';
  if (HANOI.test(lower)) return 'hanoi';
  if (DA_NANG.test(lower)) return 'da_nang';
  return 'other';
}

// Provinces and cities outside coverage, in the accented and unaccented forms
// the sources print and the slug forms that appear in listing URLs. Matching
// any of these is a hard reject - a Nha Trang listing is not a near miss for a
// District 1 crawl, it is a different market.
const OUT_OF_SCOPE = /(kh(á|a)nh\s?h(ò|o)a|khanh-hoa|nha\s?trang|nha-trang|tr(ư|u)(ờ|o)ng\s?sa|cam\s?ranh|b(ì|i)nh\s?d(ư|u)(ơ|o)ng|binh-duong|th(ủ|u)\s?d(ầ|a)u\s?m(ộ|o)t|thu-dau-mot|d(ĩ|i)\s?an|thu(ậ|a)n\s?an|b(ế|e)n\s?c(á|a)t|(đ|d)(ồ|o)ng\s?nai|dong-nai|bi(ê|e)n\s?h(ò|o)a|bien-hoa|nh(ơ|o)n\s?tr(ạ|a)ch|b(à|a)\s?r(ị|i)a|v(ũ|u)ng\s?t(à|a)u|vung-tau|h(ả|a)i\s?ph(ò|o)ng|hai-phong|h(ư|u)ng\s?y(ê|e)n|hung-yen|v(ă|a)n\s?giang|b(ắ|a)c\s?ninh|bac-ninh|b(ắ|a)c\s?giang|h(ả|a)i\s?d(ư|u)(ơ|o)ng|hai-duong|qu(ả|a)ng\s?ninh|quang-ninh|h(ạ|a)\s?long|ha-long|v(ĩ|i)nh\s?ph(ú|u)c|vinh-phuc|th(á|a)i\s?nguy(ê|e)n|ph(ú|u)\s?th(ọ|o)|ninh\s?b(ì|i)nh|nam\s?(đ|d)(ị|i)nh|h(à|a)\s?nam|hu(ế|e)|th(ừ|u)a\s?thi(ê|e)n|qu(ả|a)ng\s?nam|h(ộ|o)i\s?an|hoi-an|qu(ả|a)ng\s?ng(ã|a)i|b(ì|i)nh\s?(đ|d)(ị|i)nh|quy\s?nh(ơ|o)n|ph(ú|u)\s?y(ê|e)n|tuy\s?h(ò|o)a|b(ì|i)nh\s?thu(ậ|a)n|phan\s?thi(ế|e)t|ninh\s?thu(ậ|a)n|phan\s?rang|l(â|a)m\s?(đ|d)(ồ|o)ng|lam-dong|(đ|d)(à|a)\s?l(ạ|a)t|da-lat|(đ|d)(ắ|a)k\s?l(ắ|a)k|bu(ô|o)n\s?ma\s?thu(ộ|o)t|gia\s?lai|pleiku|kon\s?tum|c(ầ|a)n\s?th(ơ|o)|can-tho|ki(ê|e)n\s?giang|ph(ú|u)\s?qu(ố|o)c|phu-quoc|an\s?giang|(đ|d)(ồ|o)ng\s?th(á|a)p|ti(ề|e)n\s?giang|m(ỹ|y)\s?tho|b(ế|e)n\s?tre|v(ĩ|i)nh\s?long|tr(à|a)\s?vinh|s(ó|o)c\s?tr(ă|a)ng|b(ạ|a)c\s?li(ê|e)u|c(à|a)\s?mau|h(ậ|a)u\s?giang|long\s?an|t(â|a)n\s?an|t(â|a)y\s?ninh|b(ì|i)nh\s?ph(ư|u)(ớ|o)c|ngh(ệ|e)\s?an|thanh\s?h(ó|o)a|h(à|a)\s?t(ĩ|i)nh|qu(ả|a)ng\s?b(ì|i)nh|(đ|d)(ồ|o)ng\s?h(ớ|o)i|qu(ả|a)ng\s?tr(ị|i)|l(à|a)o\s?cai|sa\s?pa|(đ|d)i(ệ|e)n\s?bi(ê|e)n|s(ơ|o)n\s?la|h(ò|o)a\s?b(ì|i)nh|y(ê|e)n\s?b(á|a)i|tuy(ê|e)n\s?quang|l(ạ|a)ng\s?s(ơ|o)n|cao\s?b(ằ|a)ng|b(ắ|a)c\s?k(ạ|a)n|h(à|a)\s?giang|th(á|a)i\s?b(ì|i)nh)/i;

// True when the text names a place Hausto does not cover. Checked only after
// detectCity has failed to place the listing in a supported city, so a District
// 7 address that also mentions a Bình Dương landmark still resolves to HCMC.
export function isOutOfScopeLocation(...texts: (string | null | undefined)[]): boolean {
  const haystack = texts.filter(Boolean).join(' \n ');
  if (!haystack) return false;
  if (detectCity(haystack) !== 'other') return false;
  return OUT_OF_SCOPE.test(haystack);
}
