// What chat-ai reads out of a renter's message: the budget, the bedroom count,
// the amenities, and which parts of the message name places to stay AWAY from.
// Pure functions, no Deno APIs, so vitest covers them (chat-search-parse.test.ts).

// A unit after a number that means millions of dong. Never followed by a
// letter or a 2/², so "70 m2", "70m²" and "6 months" are not budgets.
const MILLIONS = '(mil|million|m|tr|triệu|trieu)(?![\\p{L}²2])';

export function parsePrice(text: string): number | null {
  const lower = text.toLowerCase();
  // A range - "12-15M", "12M–15M", "12 to 15 million" - is a ceiling of its
  // upper end. Read first: the patterns below would otherwise take whichever
  // number they reach, or, for "12-15 million", none at all.
  const range = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:${MILLIONS})?\\s*(?:-|–|—|to)\\s*(\\d+(?:\\.\\d+)?)\\s*${MILLIONS}`, 'iu',
  ).exec(lower);
  if (range) {
    const value = parseFloat(range[3]) * 1_000_000;
    if (value > 0 && value < 100_000_000) return value;
  }

  const patterns = [
    new RegExp(`(?:under|below|less than|dưới|max|maximum|budget)(?:\\s+(?:of|is|around|about))?\\s*(\\d+(?:\\.\\d+)?)\\s*${MILLIONS}`, 'giu'),
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${MILLIONS}\\s*(?:or less|max|maximum|budget|vnd)`, 'giu'),
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:vnd|đồng|dong)/gi, // Direct VND amounts
  ];

  for (const pattern of patterns) {
    for (const match of lower.matchAll(pattern)) {
      let value = parseFloat(match[1].replace(/,/g, ''));
      // Convert to VND if in millions
      if (match[2] && /mil|million|m|tr|triệu|trieu/i.test(match[2])) {
        value = value * 1_000_000;
      }
      if (value > 0 && value < 100_000_000) { // Reasonable price range
        return value;
      }
    }
  }
  return null;
}

// Returns canonical bedroom token: "studio", "1", "2", "3", "4+", or null
export function parseBedrooms(text: string): string | null {
  const lower = text.toLowerCase();
  // Studio
  if (/\bstudio\b/.test(lower)) return 'studio';
  // "2 bedroom(s)", "2-bedroom", "2 bed", "2br", "2-br", "2bd", "2 phòng ngủ",
  // "2 phong ngu", "2 pn", "2pn". The hyphen matters: "2-bedroom" is how most
  // people write it, and missing it dropped the bedroom filter altogether.
  const patterns: RegExp[] = [
    /(\d+)\s*\+?\s*-?\s*(?:bed\s*-?\s*rooms?|beds?)\b/,
    /(\d+)\s*\+?\s*-?\s*br\b/,
    /(\d+)\s*\+?\s*-?\s*bd\b/,
    /(\d+)\s*\+?\s*ph[oòô]ng\s*ng[uủ]/,
    /(\d+)\s*\+?\s*pn\b/,
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n >= 1) {
        if (n >= 4) return '4+';
        return String(n);
      }
    }
  }
  // "one bedroom", "two-bedroom"
  const wordMap: Record<string, string> = {
    one: '1', two: '2', three: '3', four: '4+', five: '4+',
    một: '1', hai: '2', ba: '3', bốn: '4+', mot: '1', bon: '4+',
  };
  for (const [w, n] of Object.entries(wordMap)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${w}[\\s-]+(?:bed\\s*-?\\s*room|ph[oòô]ng\\s*ng[uủ])`, 'iu');
    if (re.test(lower)) return n;
  }
  return null;
}

const AMENITY_TERMS: Record<string, string[]> = {
  'balcony': ['balcony', 'balconies', 'ban công', 'ban cong'],
  'pool': ['pool', 'swimming', 'hồ bơi', 'ho boi', 'bể bơi', 'be boi'],
  'gym': ['gym', 'fitness', 'phòng gym', 'phong gym', 'tập gym', 'tap gym'],
  'parking': ['parking', 'đỗ xe', 'do xe', 'bãi đỗ', 'bai do', 'garage'],
  'pet': ['pet', 'thú cưng', 'thu cung', 'dog', 'cat', 'chó', 'cho', 'mèo', 'meo'],
  'furnished': ['furnished', 'nội thất', 'noi that', 'đầy đủ', 'day du'],
  'wifi': ['wifi', 'internet', 'mạng', 'mang'],
  'elevator': ['elevator', 'thang máy', 'thang may', 'lift'],
  'security': ['security', 'bảo vệ', 'bao ve', 'an ninh'],
  'garden': ['garden', 'vườn', 'vuon', 'sân vườn', 'san vuon'],
  'sofa': ['sofa', 'ghế sofa', 'ghe sofa', 'couch'],
  'tv': ['tv', 'tivi', 'ti vi', 'television', 'smart tv'],
  'washing machine': ['washing machine', 'máy giặt', 'may giat', 'laundry'],
  'air conditioning': ['air conditioning', 'aircon', 'air con', 'ac', 'a/c', 'điều hòa', 'dieu hoa', 'máy lạnh', 'may lanh'],
  'kitchen': ['kitchen', 'bếp', 'bep', 'nhà bếp', 'nha bep'],
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole words, plural allowed. A substring test read "access" as AC, "location"
// as a cat and "carpet" as a pet, and each of those became a soft requirement
// the renter never asked for.
const AMENITY_RES: Array<[string, RegExp]> = Object.entries(AMENITY_TERMS).map(([canonical, terms]) => [
  canonical,
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRegex).join('|')})(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu'),
]);

export function extractAmenities(text: string): string[] {
  return AMENITY_RES.filter(([, re]) => re.test(text)).map(([canonical]) => canonical);
}

// The start of a place name as a renter types it: "District 2", "D2", "Q2",
// "quận 2", or one of the named districts and wards.
const PLACE = '(?:(?:d|q|district|quan|quận)\\s*\\d|binh thanh|bình thạnh|binh tan|bình tân|phu nhuan|phú nhuận|tan binh|tân bình|tan phu|tân phú|go vap|gò vấp|thu duc|thủ đức|thao dien|thảo điền|an phu|an phú|thu thiem|thủ thiêm|phu my hung|phú mỹ hưng)(?![\\p{L}])';

// The words that turn the places after them into places to stay out of.
// "not" and "no" count only when a place follows directly ("but not District
// 4"), since "not too far from District 1" asks for District 1.
const AVOID_TRIGGER = new RegExp([
  '(?<![\\p{L}])(?:avoid|avoiding|excluding|exclude|except(?:\\s+for)?|other than|anywhere but|rather not (?:be |live |stay )?in|stay away from|steer clear of)(?![\\p{L}])',
  "(?<![\\p{L}])(?:don'?t|do not|doesn'?t|does not|won'?t|wouldn'?t)\\s+(?:want|like|need)(?:\\s+to\\s+(?:be|live|stay|look))?(?:\\s+in)?(?![\\p{L}])",
  `(?<![\\p{L}])not\\s+(?:in\\s+|near\\s+)?(?=${PLACE})`,
  `(?<![\\p{L}])no\\s+(?=${PLACE})`,
].join('|'), 'giu');

// Where an avoid clause stops: the end of the sentence, or a turn back to what
// the renter does want.
const CLAUSE_END = /[.;!?\n]|\b(?:but|however|though|although|instead|prefer(?:ably|red)?|ideally|i'?d like|i want|i like|i love|i'?m (?:fine|ok|okay|open))\b/i;
const HAS_PLACE = new RegExp(`(?<![\\p{L}])${PLACE}`, 'iu');
const LIST_GOES_ON = new RegExp(`^\\s*(?:(?:and|or)\\s+)?${PLACE}`, 'iu');

// The clause after a trigger. A comma ends it unless the clause is a list of
// places carrying on past the comma ("avoid D9, D2 and Binh Tan"), so "don't
// want anything noisy, D1 is fine" leaves District 1 alone.
function avoidClause(rest: string): string {
  const hardEnd = rest.search(CLAUSE_END);
  const sentence = hardEnd === -1 ? rest : rest.slice(0, hardEnd);
  const parts = sentence.split(',');
  let clause = parts[0];
  for (const next of parts.slice(1)) {
    if (!HAS_PLACE.test(clause) || !LIST_GOES_ON.test(next)) break;
    clause += ',' + next;
  }
  return clause;
}

/**
 * Splits a message into the places it asks for and the places it asks to
 * avoid. Returns the avoid clauses and the message with them taken out, so the
 * caller's district extractor can read each half. Without this, "I would
 * prefer to avoid District 9 and District 2" filtered the search down to
 * exactly District 9 and District 2.
 */
export function splitAvoidedAreas(text: string): { wanted: string; avoided: string[] } {
  const avoided: string[] = [];
  let wanted = '';
  let last = 0;
  const trigger = new RegExp(AVOID_TRIGGER.source, AVOID_TRIGGER.flags);
  let m: RegExpExecArray | null;
  while ((m = trigger.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const clause = avoidClause(text.slice(start));
    if (clause.trim()) avoided.push(clause.trim());
    wanted += text.slice(last, m.index) + ' ';
    last = start + clause.length;
    trigger.lastIndex = Math.max(last, start + 1);
  }
  wanted += text.slice(last);
  return { wanted, avoided };
}
