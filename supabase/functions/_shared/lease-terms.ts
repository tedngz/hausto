// The lease terms a listing's own source states (SPEC §0 "Lease terms"):
// whether the unit is free and from when, the minimum lease, the deposit, the
// fees on top of the rent, and pets.
//
// They are what renters ask first, after the photos and the price, and the AI
// answering them (chat-ai, the comparison engine, the AI operator's drafts to
// renters) can only repeat what it is given. So the terms are read once, where
// the listing is read, and stored as columns - not left in a description that
// has since been rewritten to three sentences about the light.
//
// Two kinds of source, read two ways:
//
//   - Typed fields. jhouse's CRM publishes all five (`pet_policy`,
//     `minimum_lease_months`, `deposit_months`, `included_services`,
//     `excluded_fees`, `available_from`); rentapartment publishes a deposit
//     (Houzez's "garage size" field, relabelled "Deposit" on the page) and a
//     "Pet Allowed" tag. Those are taken as they are.
//   - Text: the ad's own words, before the rewrite. `readTermsFromText` reads
//     them, English and Vietnamese, like price-mentions.ts reads rents.
//
// Built to under-report, for the same reason price-mentions.ts is. A term it
// misses costs nothing: the AI says the ad does not say, and the AI operator
// asks the agent in the first message (realtor/drafts.ts). A term it invents
// is a promise to a renter that nobody made - a deposit they budget for, a cat
// they bring to a viewing. So a sentence that hedges ("subject to approval",
// "tùy căn") says nothing, and a number counts only beside the word for what
// it is.
//
// No Deno APIs: the ops console imports it through drafts.ts.

export const LISTING_AVAILABILITY = ['AVAILABLE_NOW', 'AVAILABLE_SOON'] as const;
export type ListingAvailability = typeof LISTING_AVAILABILITY[number];

export const FEE_KINDS = [
  'ELECTRICITY', 'WATER', 'UTILITIES', 'MANAGEMENT', 'SERVICE', 'PARKING', 'INTERNET', 'CLEANING', 'LAUNDRY', 'OTHER',
] as const;
export type FeeKind = typeof FEE_KINDS[number];

/** One charge: covered by the rent, or paid on top - at `amount` where the source says. */
export interface Fee {
  kind: FeeKind;
  /** English, for a renter: "Electricity", or the source's own ("Room cleaning 1 time/week"). */
  label: string;
  included: boolean;
  /** As the source prices it, tidied: "4,000 VND/kWh", "government rate". Null when unpriced. */
  amount: string | null;
}

export interface LeaseTerms {
  /** Null when the source does not say. */
  availability: ListingAvailability | null;
  /** YYYY-MM-DD, with AVAILABLE_SOON when the source dates it. */
  availableFrom: string | null;
  minLeaseMonths: number | null;
  /** A range, because sources write "1-2 months". Equal when they give one figure. */
  depositMonthsMin: number | null;
  depositMonthsMax: number | null;
  /** True or false only when said plainly. "Subject to approval" is null. */
  petsAllowed: boolean | null;
  /** Empty when the source says nothing about fees. */
  fees: Fee[];
}

export const NO_TERMS: LeaseTerms = Object.freeze({
  availability: null,
  availableFrom: null,
  minLeaseMonths: null,
  depositMonthsMin: null,
  depositMonthsMax: null,
  petsAllowed: null,
  fees: [] as Fee[],
}) as LeaseTerms;

/** The four a renter can be told "the ad does not say" about. Availability is always asked anyway. */
export const ASKABLE_TERMS = ['DEPOSIT', 'MIN_LEASE', 'PETS', 'FEES'] as const;
export type AskableTerm = typeof ASKABLE_TERMS[number];

// A deposit outside this is a misread: "cọc 30 triệu" read as months.
const DEPOSIT_RANGE: [number, number] = [0.5, 6];
// A minimum lease outside this is a misread, or a sale.
const LEASE_RANGE: [number, number] = [1, 60];

const DEFAULT_LABEL: Record<FeeKind, string> = {
  ELECTRICITY: 'Electricity',
  WATER: 'Water',
  UTILITIES: 'Utilities',
  MANAGEMENT: 'Management fee',
  SERVICE: 'Service fee',
  PARKING: 'Parking',
  INTERNET: 'Internet',
  CLEANING: 'Cleaning',
  LAUNDRY: 'Laundry',
  OTHER: 'Other fees',
};

/** Each fee kind's English name, for a form that offers them. */
export const FEE_LABELS: Readonly<Record<FeeKind, string>> = DEFAULT_LABEL;

// ── Reading text ─────────────────────────────────────────────────────────────

/** Lowercase, accents folded: "Cọc 2 tháng" -> "coc 2 thang". Matching only. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

// Sentences and lines. Commas stay inside a clause: "cọc 2 tháng, thuê tối
// thiểu 6 tháng" is two facts in one clause, and each pattern below is
// anchored on its own word, so they do not bleed into each other.
const SENTENCE_BREAK = /(?:\r?\n)+|[;!?•|]+|\.(?=\s|$)/;

function sentences(text: string): string[] {
  return fold(text)
    // A label and its value in cells of their own: "Minimum lease:" / "12 months".
    .replace(/:[ \t]*(?:\r?\n[ \t]*)+/g, ': ')
    // "Min. lease" is not the end of a sentence.
    .replace(/\b(min|max|approx|incl|excl)\.\s/g, '$1 ')
    .split(SENTENCE_BREAK).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12, eighteen: 18, twenty: 20,
  'mot': 1, 'hai': 2, 'ba': 3, 'bon': 4, 'sau': 6,
};

function toNumber(raw: string): number | null {
  const word = NUMBER_WORDS[raw.trim()];
  if (word !== undefined) return word;
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(\d+(?:[.,]5)?|one|two|three|four|five|six|twelve|eighteen|twenty|mot|hai|ba|bon|sau)`;
const MONTHS = String.raw`(?:months?|mos?|thang|th)\b`;
const YEARS = String.raw`(?:years?|yrs?|nam)\b`;
// A sentence carrying one of these is a maybe, and a maybe is not a term.
const HEDGE = /\b(subject to|approval|approve|case[- ]by[- ]case|negotiab\w*|negotiat\w*|depend\w*|vary|varies|may be|might|confirm|discuss|ask|upon request|on request|typically|usually|generally|approximately|estimated|tuy|thoa thuan|thuong luong|trao doi|hoi lai)\b/;
// And for pets, a limit is a maybe too: "pets under 5kg are welcome" is no
// answer for a renter with a labrador.
const PET_HEDGE = /\b(small|under|below|up to|\d+\s*kg|only|restrict\w*|notice|permission|prior|check|certain|some|nho|duoi)\b/;

// ── Deposit ──────────────────────────────────────────────────────────────────

const DEPOSIT_PATTERNS: RegExp[] = [
  // "deposit: 2 months", "deposit of 1.5 months", "deposit is 2 months' rent", "deposit 1-2 months"
  new RegExp(String.raw`\bdeposit(?:\s+(?:is|of|required|amount))*\s*[:=-]?\s*${NUM}(?:\s*(?:-|to|~)\s*${NUM})?\s*${MONTHS}`),
  // "2 months deposit", "2-month deposit", "two months' deposit"
  new RegExp(String.raw`\b${NUM}(?:\s*(?:-|to|~)\s*${NUM})?[\s-]*${MONTHS}'?s?\s+(?:rent\s+(?:as\s+)?(?:a\s+)?(?:security\s+)?)?(?:security\s+)?deposit`),
  // "cọc 2 tháng", "đặt cọc 1,5 tháng", "cọc 1-2 tháng"
  new RegExp(String.raw`\b(?:dat\s+)?coc\s*:?\s*${NUM}(?:\s*(?:-|den|~)\s*${NUM})?\s*${MONTHS}`),
  // "cọc 1 đóng 3", "cọc 2 trả 1": the payment cycle names months without the word
  new RegExp(String.raw`\bcoc\s*${NUM}\s+(?:dong|tra|thanh toan|tt)\s*\d`),
];

function readDeposit(clauses: string[]): [number, number] | null {
  for (const c of clauses) {
    if (HEDGE.test(c) && !/\bdeposit\s*:/.test(c)) continue;
    for (const re of DEPOSIT_PATTERNS) {
      const m = c.match(re);
      if (!m) continue;
      const lo = toNumber(m[1]);
      const hi = m[2] ? toNumber(m[2]) : lo;
      if (lo === null || hi === null || hi < lo) continue;
      if (lo < DEPOSIT_RANGE[0] || hi > DEPOSIT_RANGE[1]) continue;
      return [lo, hi];
    }
  }
  return null;
}

/** A source's deposit field: "2", "1.5", "1-2", "1 month", "2 months". */
export function depositFromField(raw: unknown): [number, number] | null {
  const text = fold(String(raw ?? '')).trim();
  const m = text.match(/^(\d+(?:[.,]\d+)?)(?:\s*(?:-|to|~)\s*(\d+(?:[.,]\d+)?))?\s*(?:months?|thang)?$/);
  if (!m) return null;
  const lo = toNumber(m[1]);
  const hi = m[2] ? toNumber(m[2]) : lo;
  if (lo === null || hi === null || hi < lo || lo < DEPOSIT_RANGE[0] || hi > DEPOSIT_RANGE[1]) return null;
  return [lo, hi];
}

// ── Minimum lease ────────────────────────────────────────────────────────────

// Only a minimum is a minimum. "Hợp đồng 2 năm giá 16tr" is a discount for a
// longer contract, not the shortest one on offer, so a bare contract length
// is never read.
const LEASE_PATTERNS: RegExp[] = [
  // "minimum lease: 12 months", "minimum lease term is 1 year", "min. lease 6 months", "minimum stay of 6 months"
  new RegExp(String.raw`\bmin(?:imum|\.)?\s+(?:lease|rental|rent|stay|contract|term|tenancy)(?:\s+(?:term|period|length|duration))?(?:\s+(?:is|of|required))*\s*[:=-]?\s*${NUM}\s*(${MONTHS}|${YEARS})`),
  // "lease term: minimum 6 months", "contract: at least 1 year"
  new RegExp(String.raw`\b(?:lease|contract|rental|tenancy)(?:\s+(?:term|period))?\s*[:=-]?\s*(?:a\s+)?(?:minimum|min\.?|at least)\s*(?:of\s+)?${NUM}\s*(${MONTHS}|${YEARS})`),
  // "6-month minimum", "12 months minimum lease"
  new RegExp(String.raw`\b${NUM}[\s-]*(${MONTHS}|${YEARS})\s+min(?:imum)?\b`),
  // "thuê tối thiểu 6 tháng", "hợp đồng tối thiểu 1 năm", "HĐ ít nhất 6 tháng", "thuê từ 6 tháng trở lên"
  new RegExp(String.raw`\b(?:thue|hop dong|hd)\s+(?:toi thieu|it nhat|tu)\s*${NUM}\s*(${MONTHS}|${YEARS})`),
  // "tối thiểu 6 tháng" on its own, "ký tối thiểu 1 năm"
  new RegExp(String.raw`\btoi thieu\s*:?\s*${NUM}\s*(${MONTHS}|${YEARS})`),
];

function readMinLease(clauses: string[]): number | null {
  for (const c of clauses) {
    if (HEDGE.test(c)) continue;
    for (const re of LEASE_PATTERNS) {
      const m = c.match(re);
      if (!m) continue;
      const n = toNumber(m[1]);
      if (n === null) continue;
      const months = new RegExp(YEARS).test(m[2]) ? n * 12 : n;
      if (!Number.isInteger(months) || months < LEASE_RANGE[0] || months > LEASE_RANGE[1]) continue;
      return months;
    }
  }
  return null;
}

// ── Pets ─────────────────────────────────────────────────────────────────────

// Checked before ALLOWED, which each of these contains: "không cho nuôi thú
// cưng" holds "cho nuôi thú cưng", and "not pet friendly" holds "pet friendly".
const PETS_REFUSED = [
  /\bno pets?\b/, /\bpets?\s+(?:are\s+)?not\s+(?:allowed|permitted|accepted)\b/, /\bnot\s+pet[- ]friendly\b/,
  /\bpets?\s+(?:are\s+)?(?:prohibited|forbidden)\b/, /\bdoes not allow pets?\b/,
  /\bkhong\s+(?:cho\s+(?:phep\s+)?|duoc\s+)?nuoi\s+(?:thu cung|pet|cho|meo)/, /\bcam\s+nuoi\b/, /\bkhong\s+(?:nhan\s+)?(?:thu cung|pet)\b/,
];
const PETS_ALLOWED = [
  /\bpets?\s+(?:are\s+)?(?:allowed|permitted|welcome|accepted|ok|okay)\b/, /\bpet[- ]friendly\b/, /\ballows?\s+pets?\b/,
  /\b(?:cho\s+(?:phep\s+)?|duoc\s+)nuoi\s+(?:thu cung|pet|cho|meo)/, /\bnuoi\s+(?:thu cung|pet)\s+(?:thoai mai|ok|duoc)\b/,
];

function readPets(clauses: string[]): boolean | null {
  for (const c of clauses) {
    if (!/\bpets?\b|thu cung|\bnuoi\b/.test(c)) continue;
    if (HEDGE.test(c) || PET_HEDGE.test(c)) continue;
    if (PETS_REFUSED.some((re) => re.test(c))) return false;
    if (PETS_ALLOWED.some((re) => re.test(c))) return true;
  }
  return null;
}

/** A source's pet-policy field, which is a sentence ("Không cho nuôi thú cưng"), read like one. */
export function petsFromField(raw: unknown): boolean | null {
  return typeof raw === 'string' ? readPets(sentences(raw)) : null;
}

// ── Availability ─────────────────────────────────────────────────────────────

const AVAILABLE_NOW = [
  /\bavailable\s*:?\s*(?:now|immediately|right now|today)\b/, /\bavailable for immediate\b/, /\bimmediate(?:ly)?\s+(?:move[- ]in|occupancy|available)\b/,
  /\bready to move in\b/, /\bmove[- ]in ready\b/, /\bvacant now\b/,
  /\btrong san\b/, /\bdang trong\b/, /\b(?:vao|don vao)\s+(?:o\s+)?(?:duoc\s+)?(?:ngay|lien|luon)\b/,
];

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** YYYY-MM-DD for a day and month the text gave, in the year nearest `now`. */
function nearestDate(day: number, month: number, year: number | null, now: Date): string | null {
  const iso = (y: number) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // 31/02 is not a date, and Date would roll it into March.
  const real = (y: number) => !Number.isNaN(Date.parse(iso(y))) && new Date(Date.parse(iso(y))).toISOString().slice(0, 10) === iso(y);
  if (year !== null) return year >= 2000 && year < 2100 && real(year) ? iso(year) : null;
  const t = now.getTime();
  const y = now.getUTCFullYear();
  const nearest = [y - 1, y, y + 1].sort((a, b) => Math.abs(Date.parse(iso(a)) - t) - Math.abs(Date.parse(iso(b)) - t))[0];
  return real(nearest) ? iso(nearest) : null;
}

// "available from 1 Nov", "available from November 1st, 2026", "available from 01/11/2026",
// "trống từ ngày 15/11", "từ 1/11 vào ở được"
function readAvailableFrom(c: string, now: Date): string | null {
  const intro = /\b(?:available\s+(?:from|on|starting)|move[- ]in\s+(?:from|on)|vacant\s+from|trong\s+(?:tu|vao)(?:\s+ngay)?|vao o\s+(?:tu|duoc tu)(?:\s+ngay)?|don vao\s+(?:tu)?(?:\s+ngay)?)\s*:?\s*/;
  const m = c.match(intro);
  if (!m) return null;
  const rest = c.slice((m.index ?? 0) + m[0].length);
  let d: RegExpMatchArray | null;
  if ((d = rest.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?\b/))) {
    return nearestDate(Number(d[1]), Number(d[2]), d[3] ? Number(d[3]) : null, now);
  }
  if ((d = rest.match(/^(\d{4})-(\d{2})-(\d{2})\b/))) {
    return nearestDate(Number(d[3]), Number(d[2]), Number(d[1]), now);
  }
  if ((d = rest.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?,?(?:\s+(\d{4}))?/))) {
    const month = MONTH_NAMES[d[2].slice(0, 4)] ?? MONTH_NAMES[d[2].slice(0, 3)];
    return month ? nearestDate(Number(d[1]), month, d[3] ? Number(d[3]) : null, now) : null;
  }
  if ((d = rest.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?/))) {
    const month = MONTH_NAMES[d[1].slice(0, 4)] ?? MONTH_NAMES[d[1].slice(0, 3)];
    return month ? nearestDate(Number(d[2]), month, d[3] ? Number(d[3]) : null, now) : null;
  }
  return null;
}

/** YYYY-MM-DD in Ho Chi Minh City. */
export function hcmcDay(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** A source's date as availability: later than today is soon, today or earlier is now. */
export function availabilityFromDate(date: string | null, now: Date): Pick<LeaseTerms, 'availability' | 'availableFrom'> {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { availability: null, availableFrom: null };
  return date > hcmcDay(now)
    ? { availability: 'AVAILABLE_SOON', availableFrom: date }
    : { availability: 'AVAILABLE_NOW', availableFrom: null };
}

function readAvailability(clauses: string[], now: Date): Pick<LeaseTerms, 'availability' | 'availableFrom'> {
  for (const c of clauses) {
    if (/\bcheck availability\b/.test(c)) continue;
    const from = readAvailableFrom(c, now);
    if (from) return availabilityFromDate(from, now);
    // vnrenthome's details line: "Available:" and "Immediately" in cells of their own.
    if (AVAILABLE_NOW.some((re) => re.test(c))) return { availability: 'AVAILABLE_NOW', availableFrom: null };
  }
  return { availability: null, availableFrom: null };
}

// ── Fees ─────────────────────────────────────────────────────────────────────

// What each charge is called, on folded text. Vietnamese "điện" alone is also
// a phone ("điện thoại") or an electric bus, and "nước" alone is also a
// country ("người nước ngoài"), so each counts only where a price or a rate
// follows, or as the pair "điện nước". "Tiện ích" is amenities, never
// utilities, and is not here at all; nor is "bảo vệ", a security guard, which
// "bao" (covers) would otherwise read as "the rent includes".
const FEE_WORDS: [FeeKind, RegExp][] = [
  ['ELECTRICITY', /\belectricity\b(?:\s+(?:fee|bill|charge|cost)s?)?|\belectric\s+(?:fee|bill|charge)s?\b|\bpower\s+(?:fee|bill)s?\b|\b(?:tien|gia|phi)\s+dien\b|\bdien(?=\s*(?::|\d|nuoc\b|,\s*nuoc\b|theo\b|gia\b|tinh\b))/],
  ['WATER', /(?<!drinking\s|hot\s|bottled\s)\b(?:running\s+|usage\s+)?water(?!\s*(?:heater|view|front|park|fall|proof|side|feature|purifier|dispenser|filter))(?:\s+(?:fee|bill|charge|usage))?\b|\b(?:tien|gia|phi)\s+nuoc\b|(?<=dien\s|dien,\s)nuoc\b|\bnuoc(?=\s*(?::|\d|theo\b|gia\b|tinh\b))/],
  ['UTILITIES', /\butilit(?:y|ies)(?:\s+(?:fee|bill|charge)s?)?\b/],
  ['MANAGEMENT', /\b(?:management|maintenance)\s+fees?\b|\bphi\s+(?:quan\s+ly|ql)\b|\bpql\b/],
  ['SERVICE', /\bservice\s+(?:fees?|charges?)\b|\bphi\s+(?:dich\s+vu|dv)\b|\bpdv\b/],
  ['PARKING', /\b(?:(?:motorbike|motorcycle|bike|car|scooter)\s+)?parking(?:\s+(?:fee|space|spot)s?)?\b|\b\d+\s+(?:motor)?bikes?\b|\b(?:motor)?bikes?(?=\s*:)|\bphi\s+(?:gui\s+|giu\s+)?xe(?:\s+(?:may|hoi|o\s?to|oto))?\b|\b(?:gui|giu)\s+xe(?:\s+(?:may|hoi|o\s?to|oto))?\b|\bxe\s+(?:may|hoi|o\s?to|oto)(?=\s*:)/],
  ['INTERNET', /\b(?:internet|wi-?fi|cable\s+tv|truyen\s+hinh\s+cap)\b/],
  ['CLEANING', /\b(?:room\s+|weekly\s+)?cleaning\b|\bhousekeeping\b|\bdon\s+(?:phong|dep|ve\s+sinh)\b|\bve\s+sinh\s+phong\b/],
  ['LAUNDRY', /\blaundry\b|\bgiat\s+(?:ui|la|do)\b/],
];

/** "Parking" says which vehicle where the source does: a car costs ten times a motorbike. */
function parkingLabel(hit: string): string {
  if (/\b(?:car|hoi|o\s?to|oto)\b/.test(hit)) return 'Car parking';
  if (/\b(?:motor|bike|scooter|may)/.test(hit)) return 'Motorbike parking';
  return DEFAULT_LABEL.PARKING;
}

// A price, on folded text: dollars, "1tr650" (1,650,000), grouped thousands,
// shorthand ("4k", "18.5 triệu"), or a bare figure with a currency - each
// with up to two units after it ("/person/month").
const MONEY = String.raw`(?:\$\s?\d[\d,.]*|\d+\s*(?:tr|trieu)\s*\d{1,3}\b|\d{1,3}(?:[.,]\d{3})+(?:\s*(?:vnd|vn dong|dong|d|usd)\b)?|\d+(?:[.,]\d+)?\s*(?:k|nghin|ngan|tr|trieu|million)\b|\d+\s*(?:vnd|vn dong|dong|d|usd)\b)`;
const UNIT = String.raw`(?:kwh|kw|so|m3|m³|khoi|nguoi|person|pax|head|thang|month|mo|xe|bike|motorbike|vehicle|car|phong|room|unit|can|week|tuan|m2|m²|sqm)\b`;
const AMOUNT = new RegExp(String.raw`^${MONEY}(?:\s*(?:\/|per|a)\s*${UNIT}){0,2}`);
const GOVERNMENT_RATE = /^(?:at\s+|theo\s+)?(?:the\s+)?(?:government|state|evn|official|gia\s+nha\s+nuoc|gia\s+dan|nha\s+nuoc)\b(?:\s+(?:price|rate|tariff|gia)s?)?/;
// Between a fee's name and its price: "Electricity fee: 4,000", "điện giá 4k", "water usage is 100k".
const LEAD_IN = /^(?:\s|:|=|-|–|\bis\b|\bare\b|\bat\b|\bcosts?\b|\bfees?\b|\bcharge\b|\busage\b|\brate\b|\bprice\b|\bgia\b|\bla\b|\btinh\b|\bthu\b)+/;

// What a fee's name is followed by when it is covered, or charged apart -
// read only where the name opens its clause ("- Parking included", "Parking
// is free"). Mid-sentence, "an all-in model with housekeeping included" was a
// remark about other buildings.
const INCLUDED_AFTER = /^(?:is\s+|are\s+)?(?:free|included|mien phi|free of charge)\b/;
const EXTRA_AFTER = /^(?:is\s+|are\s+)?(?:extra|not included|excluded|separate|paid separately|charged separately|tinh rieng|chua bao gom|khong bao gom)\b/;
const OPENS_CLAUSE = /^[\s\-*•]*(?:(?:the|all|on-?site|underground)\s+)?$/;
const FREE_BEFORE = /(?<![-\w])(?:free|mien phi)\s+(?:\d+\s+)?$/;
const NONE_BEFORE = /\b(?:no|khong)\s+$/;

// What opens a list of charges the rent covers. A subject is required in
// English: "the building includes a gym and parking" is amenities, and only
// "the rent includes" or "included in the rent" is a promise about money.
const INCLUDES = /\b(?:price|rent|rental(?:\s+price)?|monthly\s+rent|gia(?:\s+thue)?)\s+(?:also\s+)?(?:includes?|including|covers)\b|\bincluded\s+in\s+the\s+(?:rent|rental|price|monthly)|\binclusive\s+of\b|\ball[- ]inclusive\b|^[\s\-*•]*(?:includes?|included|what'?s included)\s*:|(?<![-\w])free\b(?!\s+up\s+to)|\bmien\s+phi\b|\b(?:da\s+)?bao\s+gom\b|\bbao\s+(?=(?:phi|dien|nuoc|wifi|internet|gui xe|xe|pql|ql)\b)/;
const EXCLUDES = /\b(?:excludes?|excluding|not\s+includ(?:ed|ing)|except(?:\s+for)?|chua\s+bao\s+gom|khong\s+bao\s+gom)\b/;

/** "1.350.000" -> "1,350,000": a dot between thousands reads as a decimal to an English renter. */
function groupThousands(text: string): string {
  return text.replace(/\b\d{1,3}(?:[.,]\d{3})+(?!\d)/g, (n) => n.replace(/[.,]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ','));
}

const millions = (n: number) => `${Math.round(n * 1_000_000).toLocaleString('en-US')} VND`;

function tidyAmount(raw: string): string {
  return groupThousands(
    raw.trim()
      .replace(/\b(\d+)\s*(?:tr|trieu)\s*(\d{1,3})\b/g, (_, a, b) => millions(Number(`${a}.${b}`)))
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(?:tr|trieu|million)\b/g, (_, n) => millions(parseFloat(n.replace(',', '.')))),
  )
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:k|nghin|ngan)\b/g, (_, n) => `${Math.round(parseFloat(n) * 1000).toLocaleString('en-US')} VND`)
    .replace(/(\d)\s*(?:vnd|vn dong|dong|d)\b/g, '$1 VND')
    .replace(/\busd\b/g, 'USD')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+(?:per|a)\s+/g, '/')
    .replace(/\/(?:kwh|kw|so)\b/g, '/kWh')
    .replace(/\/(?:m3|khoi)\b/g, '/m³')
    .replace(/\/(?:m2|sqm)\b/g, '/m²')
    .replace(/\/(?:nguoi|pax|head)\b/g, '/person')
    .replace(/\/(?:thang|mo)\b/g, '/month')
    .replace(/\/(?:xe|bike|motorbike)\b/g, '/vehicle')
    .replace(/\/(?:phong|can)\b/g, '/room')
    .replace(/\/tuan\b/g, '/week')
    .replace(/\s+/g, ' ')
    .trim();
}

interface FeeHit { kind: FeeKind; at: number; end: number; text: string }

function feeHits(clause: string): FeeHit[] {
  const hits: FeeHit[] = [];
  for (const [kind, re] of FEE_WORDS) {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(clause)) !== null) {
      if (m[0].length === 0) { g.lastIndex++; continue; }
      hits.push({ kind, at: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  // Overlaps keep the longer reading: "motorbike parking" is parking, once.
  return hits
    .sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at))
    .filter((h, i, all) => !all.slice(0, i).some((p) => p.end > h.at));
}

/** Every fee a clause states, in the order stated. */
function readFeeClause(clause: string): Fee[] {
  const hits = feeHits(clause);
  if (hits.length === 0) return [];
  const hedged = HEDGE.test(clause);
  const includeAt = clause.search(INCLUDES);
  const excludeAt = clause.search(EXCLUDES);
  // "Management fee (includes wifi and cleaning): 200,000" - the list is what
  // the fee covers, not the rent.
  const listOwnedByFee = hits.some((h) => (h.kind === 'MANAGEMENT' || h.kind === 'SERVICE') && h.at < includeAt);

  const read: (Fee | null)[] = hits.map((h, i) => {
    const nextAt = i + 1 < hits.length ? hits[i + 1].at : clause.length;
    const after = clause.slice(h.end, Math.min(nextAt, h.end + 60));
    const tail = after.slice(after.match(LEAD_IN)?.[0].length ?? 0);
    const before = clause.slice(0, h.at);
    // "Free parking for 2 bikes" is motorbike parking: the vehicle can follow the word.
    const label = h.kind === 'PARKING' ? parkingLabel(`${h.text} ${clause.slice(h.end, h.end + 25)}`) : DEFAULT_LABEL[h.kind];
    const fee = (included: boolean, amount: string | null): Fee => ({ kind: h.kind, label, included, amount });

    const amount = tail.match(AMOUNT)?.[0];
    if (amount) return fee(false, tidyAmount(amount));
    if (GOVERNMENT_RATE.test(tail)) return fee(false, 'government rate');
    if (FREE_BEFORE.test(before)) return fee(true, null);
    if ((h.kind === 'MANAGEMENT' || h.kind === 'SERVICE') && NONE_BEFORE.test(before)) return fee(true, null);
    if (hedged) return null;
    if (OPENS_CLAUSE.test(before)) {
      if (INCLUDED_AFTER.test(tail)) return fee(true, null);
      if (EXTRA_AFTER.test(tail)) return fee(false, null);
    }
    // A list after "the rent includes" / "bao gồm": every charge named is
    // covered, up to "except", after which every one named is not.
    if (excludeAt >= 0 && excludeAt < h.at) return fee(false, null);
    if (includeAt >= 0 && includeAt < h.at && !listOwnedByFee) return fee(true, null);
    return null;
  });

  // "Electricity and water at government rates", "điện nước giá dân": a pair
  // shares a rate or a "free", never a figure, which is always per charge.
  for (let i = hits.length - 2; i >= 0; i--) {
    const next = read[i + 1];
    if (read[i] || !next) continue;
    const gap = clause.slice(hits[i].end, hits[i + 1].at);
    if (!/^\s*(?:,|and|&|\+|va|\/)?\s*$/.test(gap)) continue;
    if (next.amount === 'government rate' || (next.included && !next.amount)) {
      read[i] = { ...next, kind: hits[i].kind, label: hits[i].kind === 'PARKING' ? parkingLabel(hits[i].text) : DEFAULT_LABEL[hits[i].kind] };
    }
  }
  // A generic "parking" beside the same charge for a named vehicle is that charge said twice.
  const vehicles = new Set(read.filter((f) => f?.kind === 'PARKING' && f.label !== DEFAULT_LABEL.PARKING).map((f) => f!.included));
  for (let i = 0; i < read.length; i++) {
    const f = read[i];
    if (f?.kind === 'PARKING' && f.label === DEFAULT_LABEL.PARKING && !f.amount && vehicles.has(f.included)) read[i] = null;
  }
  return read.filter((f): f is Fee => f !== null);
}

/** Fees are one per kind, except parking (a car and a motorbike) and the source's own extras. */
function feeKey(f: Fee): string {
  if (f.kind === 'PARKING') return `PARKING:${parkingLabel(fold(f.label))}`;
  return f.kind === 'OTHER' ? `OTHER:${fold(f.label)}` : f.kind;
}

/** One fee per key: a priced one beats "included", which beats "on top, unpriced". */
function dedupeFees(fees: Fee[]): Fee[] {
  const rank = (f: Fee) => (f.amount ? 0 : f.included ? 1 : 2);
  const best = new Map<string, Fee>();
  for (const f of fees) {
    const held = best.get(feeKey(f));
    if (!held || rank(f) < rank(held)) best.set(feeKey(f), f);
  }
  return [...best.values()];
}

function readFees(text: string): Fee[] {
  // Fees come as lists - "Services:" then one per line - so lines are read on
  // their own, and sentences within them. A bracket holding a price is part
  // of its line ("electricity (4,000 vnd/kWh)"); any other bracket is a clause
  // of its own, so "Management fee (includes wifi): 200,000" keeps its price
  // and "16 triệu (bao phí QL)" still says what the rent covers.
  const asides: string[] = [];
  const unbracketed = fold(text).replace(/\(([^()]*)\)/g, (_, inner: string) => {
    if (/^\s*[\d$]/.test(inner)) return ` ${inner} `;
    asides.push(inner);
    return ' ';
  });
  const clauses = [unbracketed, ...asides].join('\n')
    .split(/(?:\r?\n)+|[•|]+|\.(?=\s|$)|[!?]+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return dedupeFees(clauses.flatMap(readFeeClause));
}

/**
 * Everything a listing's own words state, and nothing they only hint at.
 * `now` places a date written without a year ("available from 1/11").
 */
export function readTermsFromText(text: string | null | undefined, now = new Date()): LeaseTerms {
  if (!text || !text.trim()) return { ...NO_TERMS, fees: [] };
  const clauses = sentences(text);
  const deposit = readDeposit(clauses);
  return {
    ...readAvailability(clauses, now),
    minLeaseMonths: readMinLease(clauses),
    depositMonthsMin: deposit?.[0] ?? null,
    depositMonthsMax: deposit?.[1] ?? null,
    petsAllowed: readPets(clauses),
    fees: readFees(text),
  };
}

// ── What an extraction model read ────────────────────────────────────────────

/**
 * The `terms` object scrape-marketplace's detail extraction asks for on the
 * pages we cannot read ourselves (batdongsan, housingsgn - Phase 3). Its
 * prompt says null unless the page states it for this unit; this checks the
 * answer against the same ranges and sets the reader keeps, and drops what
 * falls outside rather than trusting it.
 */
export const MODEL_TERMS_SHAPE = `"terms": {
    "available_from": "now" | "YYYY-MM-DD" | null,
    "min_lease_months": number | null,
    "deposit_months": number | [min, max] | null,
    "pets": "ALLOWED" | "NOT_ALLOWED" | null,
    "fees": [{ "name": "Electricity", "included": false, "amount": "4,000 VND/kWh" | null }]
  }`;

export const MODEL_TERMS_RULE = `TERMS: only what this page states for THIS unit - never what is typical, never what the building or another listing says. "available_from": "now" when it says the unit is free now or move-in is immediate, a date when it names one, else null. "min_lease_months": only a stated minimum (a "2-year contract" discount is not a minimum). "deposit_months": in months of rent, only when stated in months. "pets": null when it hedges ("subject to approval", "small pets", "negotiable"). "fees": each charge the page names, "included": true when the rent covers it, "amount" as written in English ("4,000 VND/kWh", "government rate") or null. Use null and [] when the page does not say.`;

export function termsFromModel(raw: unknown, now = new Date()): LeaseTerms {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const av = typeof t.available_from === 'string' ? t.available_from.trim().toLowerCase() : '';
  const availability = av === 'now'
    ? { availability: 'AVAILABLE_NOW' as const, availableFrom: null }
    : availabilityFromDate(/^\d{4}-\d{2}-\d{2}$/.test(av) ? av : null, now);
  const lease = Number(t.min_lease_months);
  const dep = Array.isArray(t.deposit_months) ? t.deposit_months.map(Number) : [Number(t.deposit_months)];
  const [lo, hi] = [dep[0], dep[1] ?? dep[0]];
  const depositOk = Number.isFinite(lo) && Number.isFinite(hi) && t.deposit_months != null
    && lo >= DEPOSIT_RANGE[0] && hi <= DEPOSIT_RANGE[1] && hi >= lo;
  const fees: Fee[] = (Array.isArray(t.fees) ? t.fees : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof f.name === 'string' && f.name.trim() !== '')
    .map((f) => {
      const name = String(f.name).trim();
      const kind = feeKindOf(name);
      return {
        kind,
        label: kind === 'OTHER' || kind === 'PARKING' ? name : DEFAULT_LABEL[kind],
        included: f.included === true,
        amount: f.included === true ? null : feeAmountFromField(f.amount),
      };
    });
  return {
    ...availability,
    minLeaseMonths: Number.isInteger(lease) && lease >= LEASE_RANGE[0] && lease <= LEASE_RANGE[1] ? lease : null,
    depositMonthsMin: depositOk ? lo : null,
    depositMonthsMax: depositOk ? hi : null,
    petsAllowed: t.pets === 'ALLOWED' ? true : t.pets === 'NOT_ALLOWED' ? false : null,
    fees: dedupeFees(fees),
  };
}

// ── Combining ────────────────────────────────────────────────────────────────

/**
 * The source's typed fields first, its text where they say nothing. Fees
 * merge by kind, so a typed list is completed by the text, not replaced.
 */
export function mergeTerms(primary: Partial<LeaseTerms>, fallback: LeaseTerms): LeaseTerms {
  const hasDeposit = primary.depositMonthsMin != null;
  const hasAvailability = primary.availability != null;
  const primaryFees = primary.fees ?? [];
  const kinds = new Set(primaryFees.map(feeKey));
  return {
    availability: hasAvailability ? primary.availability! : fallback.availability,
    availableFrom: hasAvailability ? primary.availableFrom ?? null : fallback.availableFrom,
    minLeaseMonths: primary.minLeaseMonths ?? fallback.minLeaseMonths,
    depositMonthsMin: hasDeposit ? primary.depositMonthsMin! : fallback.depositMonthsMin,
    depositMonthsMax: hasDeposit ? primary.depositMonthsMax ?? primary.depositMonthsMin! : fallback.depositMonthsMax,
    petsAllowed: primary.petsAllowed ?? fallback.petsAllowed,
    fees: [...primaryFees, ...fallback.fees.filter((f) => !kinds.has(feeKey(f)))],
  };
}

/** The kind a source's own fee label names, or OTHER. */
export function feeKindOf(label: string): FeeKind {
  const text = fold(label);
  return feeHits(text)[0]?.kind ?? 'OTHER';
}

/** A source's price for a fee: "Government price" -> "government rate", else as written. Null when blank. */
export function feeAmountFromField(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (GOVERNMENT_RATE.test(fold(raw).trim())) return 'government rate';
  return groupThousands(raw.replace(/\s+/g, ' ').trim());
}

// ── Storing ──────────────────────────────────────────────────────────────────

/** The columns on external_properties. `readAt` says when the source was read, so a NULL means "not said" rather than "never looked". */
export function termsColumns(t: LeaseTerms, readAt: string): Record<string, unknown> {
  return {
    availability: t.availability,
    available_from: t.availableFrom,
    min_lease_months: t.minLeaseMonths,
    deposit_months_min: t.depositMonthsMin,
    deposit_months_max: t.depositMonthsMax,
    pets_allowed: t.petsAllowed,
    fees: t.fees.length > 0 ? t.fees : null,
    terms_read_at: readAt,
  };
}

export const TERMS_COLUMNS = 'availability, available_from, min_lease_months, deposit_months_min, deposit_months_max, pets_allowed, fees, terms_read_at';

// ── What an agent said ───────────────────────────────────────────────────────
//
// The first message to an agent asks about whatever the ad leaves out
// (askAgentVi, below), and their answer is recorded as LEASE_TERMS_RECORDED
// (ops-actions.ts LEASE_TERMS): on the request's log, per item, and never on
// the listing's columns (SPEC §0 "Lease terms"). The columns say what the ad
// states; this says what one agent told us, on one day.

/** Anything stated at all. */
export function hasTerms(t: LeaseTerms | null | undefined): boolean {
  return !!t && (t.availability !== null || t.minLeaseMonths !== null || t.depositMonthsMin !== null
    || t.petsAllowed !== null || t.fees.length > 0);
}

/** The terms as an event's payload: the columns' names, without `terms_read_at`. */
export function termsPayload(t: LeaseTerms): Record<string, unknown> {
  const { terms_read_at: _readAt, ...columns } = termsColumns(t, '');
  return columns;
}

const inRange = (n: number, [lo, hi]: [number, number]) => n >= lo && n <= hi;

/** More than this is a list pasted in, not what an agent said. */
const MAX_FEES = 10;
/** A fee's label and its amount are each a few words. */
const FEE_TEXT_MAX = 60;

/**
 * A payload's terms, read as a row is and held to the same bounds: a value
 * outside them is dropped, not shown. Null when nothing valid is stated. The
 * reducer reads it, so it never throws.
 */
export function termsFromPayload(p: Record<string, unknown> | null | undefined): LeaseTerms | null {
  const row = termsFromRow({ ...(p ?? {}), terms_read_at: '' });
  if (!row) return null;
  const { readAt: _readAt, ...t } = row;
  const lease = t.minLeaseMonths;
  const [lo, hi] = [t.depositMonthsMin, t.depositMonthsMax];
  const depositOk = lo !== null && hi !== null && inRange(lo, DEPOSIT_RANGE) && inRange(hi, DEPOSIT_RANGE) && hi >= lo;
  const out: LeaseTerms = {
    availability: t.availability,
    availableFrom: t.availability === 'AVAILABLE_SOON' && t.availableFrom && /^\d{4}-\d{2}-\d{2}$/.test(t.availableFrom) ? t.availableFrom : null,
    minLeaseMonths: lease !== null && Number.isInteger(lease) && inRange(lease, LEASE_RANGE) ? lease : null,
    depositMonthsMin: depositOk ? lo : null,
    depositMonthsMax: depositOk ? hi : null,
    petsAllowed: t.petsAllowed,
    fees: t.fees.slice(0, MAX_FEES),
  };
  return hasTerms(out) ? out : null;
}

export type TermsCheck = { ok: true; value: LeaseTerms } | { ok: false; error: string };

/**
 * What an operator, or a proposal they approve, says the agent stated. Held
 * to the bounds the readers keep, and refused rather than trimmed: a deposit
 * of 30 is a typo, and recording it as "not stated" would hide that. At least
 * one term, or there is nothing to record.
 */
export function checkTerms(raw: unknown): TermsCheck {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Give the terms the agent stated.' };
  const t = raw as Record<string, unknown>;
  const isNull = (v: unknown) => v === null || v === undefined || v === '';
  // A form sends "2"; a boolean is not a number of months.
  const num = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN);

  const availability = isNull(t.availability) ? null : String(t.availability);
  if (availability !== null && !(LISTING_AVAILABILITY as readonly string[]).includes(availability)) {
    return { ok: false, error: `availability must be one of ${LISTING_AVAILABILITY.join(', ')}, or empty.` };
  }
  const availableFrom = isNull(t.availableFrom) ? null : String(t.availableFrom);
  if (availableFrom !== null) {
    const real = /^\d{4}-\d{2}-\d{2}$/.test(availableFrom)
      && new Date(`${availableFrom}T00:00:00Z`).toISOString().slice(0, 10) === availableFrom;
    if (!real) return { ok: false, error: 'The date it is free from must be a real date, YYYY-MM-DD.' };
    if (availability !== 'AVAILABLE_SOON') return { ok: false, error: 'A date it is free from goes with "available soon".' };
  }

  const lease = isNull(t.minLeaseMonths) ? null : num(t.minLeaseMonths);
  if (lease !== null && !(Number.isInteger(lease) && inRange(lease, LEASE_RANGE))) {
    return { ok: false, error: `The minimum lease is whole months, ${LEASE_RANGE[0]}-${LEASE_RANGE[1]}.` };
  }

  const lo = isNull(t.depositMonthsMin) ? null : num(t.depositMonthsMin);
  const hi = isNull(t.depositMonthsMax) ? lo : num(t.depositMonthsMax);
  if (lo === null && hi !== null) return { ok: false, error: 'Give the deposit\'s lower figure too.' };
  const halfMonths = (n: number) => Number.isFinite(n) && Number.isInteger(n * 2) && inRange(n, DEPOSIT_RANGE);
  if (lo !== null && hi !== null && !(halfMonths(lo) && halfMonths(hi) && hi >= lo)) {
    return { ok: false, error: `The deposit is in months of rent, ${DEPOSIT_RANGE[0]}-${DEPOSIT_RANGE[1]}, in half months.` };
  }

  if (!isNull(t.petsAllowed) && typeof t.petsAllowed !== 'boolean') {
    return { ok: false, error: 'Pets is yes, no, or not said.' };
  }

  const rawFees = t.fees ?? [];
  if (!Array.isArray(rawFees)) return { ok: false, error: 'fees must be a list.' };
  if (rawFees.length > MAX_FEES) return { ok: false, error: `At most ${MAX_FEES} fees.` };
  const fees: Fee[] = [];
  for (const f of rawFees as Record<string, unknown>[]) {
    const kind = String(f?.kind ?? '');
    if (!(FEE_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `A fee's kind must be one of ${FEE_KINDS.join(', ')}.` };
    const label = String(f.label ?? '').replace(/\s+/g, ' ').trim() || DEFAULT_LABEL[kind as FeeKind];
    const amount = isNull(f.amount) ? null : String(f.amount).replace(/\s+/g, ' ').trim();
    if (label.length > FEE_TEXT_MAX || (amount && amount.length > FEE_TEXT_MAX)) {
      return { ok: false, error: `Keep each fee's name and amount under ${FEE_TEXT_MAX} characters.` };
    }
    if (typeof f.included !== 'boolean') return { ok: false, error: `Say whether the rent covers ${label}.` };
    fees.push({ kind: kind as FeeKind, label, included: f.included, amount: f.included ? null : amount || null });
  }

  const value: LeaseTerms = {
    availability: availability as ListingAvailability | null,
    availableFrom,
    minLeaseMonths: lease,
    depositMonthsMin: lo,
    depositMonthsMax: hi,
    petsAllowed: isNull(t.petsAllowed) ? null : t.petsAllowed as boolean,
    fees: dedupeFees(fees),
  };
  if (!hasTerms(value)) return { ok: false, error: 'Nothing to record - fill in at least one term the agent stated.' };
  return { ok: true, value };
}

/** The same terms, however they were written down: what scoring an approval against a proposal asks. */
export function sameTerms(a: unknown, b: unknown): boolean {
  const x = checkTerms(a);
  const y = checkTerms(b);
  if (!x.ok || !y.ok) return false;
  const key = (t: LeaseTerms) => JSON.stringify({
    ...termsPayload(t),
    fees: [...t.fees].sort((f, g) => feeKey(f).localeCompare(feeKey(g))).map(f => [feeKey(f), f.included, f.amount]),
  });
  return key(x.value) === key(y.value);
}

/**
 * The terms of these listings, by id. Read on their own rather than added to
 * a wider select: a failed read (the columns not there yet, a grant missing)
 * leaves every listing "not stated" - the agent is asked about all four -
 * instead of failing the query a page or a plan depends on.
 */
// deno-lint-ignore no-explicit-any
export async function loadTerms(db: any, listingIds: string[]): Promise<Map<string, StoredTerms | null>> {
  const out = new Map<string, StoredTerms | null>();
  const ids = [...new Set(listingIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const { data, error } = await db.from('external_properties').select(`id, ${TERMS_COLUMNS}`).in('id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as Record<string, unknown>[]) out.set(String(row.id), termsFromRow(row));
  } catch (e) {
    console.warn('[lease-terms] could not read terms:', (e as Error)?.message ?? e);
  }
  return out;
}

export interface StoredTerms extends LeaseTerms {
  /** When the source was last read for them. */
  readAt: string;
}

/** A row's terms, or null when its source has never been read for them. */
export function termsFromRow(row: Record<string, unknown> | null | undefined): StoredTerms | null {
  if (!row || typeof row.terms_read_at !== 'string') return null;
  const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const availability = (LISTING_AVAILABILITY as readonly string[]).includes(String(row.availability))
    ? row.availability as ListingAvailability
    : null;
  const fees = (Array.isArray(row.fees) ? row.fees : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      kind: (FEE_KINDS as readonly string[]).includes(String(f.kind)) ? f.kind as FeeKind : 'OTHER',
      label: String(f.label ?? '').trim() || DEFAULT_LABEL.OTHER,
      included: f.included === true,
      amount: typeof f.amount === 'string' && f.amount.trim() ? f.amount.trim() : null,
    }));
  return {
    availability,
    availableFrom: typeof row.available_from === 'string' ? row.available_from.slice(0, 10) : null,
    minLeaseMonths: num(row.min_lease_months),
    depositMonthsMin: num(row.deposit_months_min),
    depositMonthsMax: num(row.deposit_months_max) ?? num(row.deposit_months_min),
    petsAllowed: typeof row.pets_allowed === 'boolean' ? row.pets_allowed : null,
    fees,
    readAt: row.terms_read_at,
  };
}

// ── Saying them ──────────────────────────────────────────────────────────────

/** Which of the askable terms the source left unsaid. All four when it was never read. */
export function unknownTerms(t: LeaseTerms | null): AskableTerm[] {
  if (!t) return [...ASKABLE_TERMS];
  const out: AskableTerm[] = [];
  if (t.depositMonthsMin === null) out.push('DEPOSIT');
  if (t.minLeaseMonths === null) out.push('MIN_LEASE');
  if (t.petsAllowed === null) out.push('PETS');
  if (t.fees.length === 0) out.push('FEES');
  return out;
}

const TERM_NAMES: Record<AskableTerm, string> = {
  DEPOSIT: 'the deposit',
  MIN_LEASE: 'the minimum lease',
  PETS: 'the pet policy',
  FEES: 'fees and utilities',
};

function months(n: number): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${s} month${n === 1 ? '' : 's'}`;
}

/** "3 Nov 2026" - a date as a renter reads it. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${d} ${name} ${y}`;
}

/** The stated terms as English phrases, one per term. Empty when nothing is stated. */
export function describeTerms(t: LeaseTerms | null): string[] {
  if (!t) return [];
  const out: string[] = [];
  if (t.availability === 'AVAILABLE_NOW') out.push('available now');
  else if (t.availability === 'AVAILABLE_SOON') {
    out.push(t.availableFrom ? `available from ${dayLabel(t.availableFrom)}` : 'available soon');
  }
  if (t.depositMonthsMin !== null) {
    const hi = t.depositMonthsMax ?? t.depositMonthsMin;
    out.push(hi > t.depositMonthsMin
      ? `deposit ${t.depositMonthsMin}-${months(hi)}' rent`
      : `deposit ${months(t.depositMonthsMin)}' rent`);
  }
  if (t.minLeaseMonths !== null) {
    out.push(t.minLeaseMonths % 12 === 0 && t.minLeaseMonths >= 12
      ? `minimum lease ${t.minLeaseMonths / 12} year${t.minLeaseMonths === 12 ? '' : 's'}`
      : `minimum lease ${months(t.minLeaseMonths)}`);
  }
  if (t.petsAllowed !== null) out.push(t.petsAllowed ? 'pets allowed' : 'no pets');
  const included = t.fees.filter((f) => f.included).map((f) => f.label);
  const extra = t.fees.filter((f) => !f.included)
    .map((f) => (f.amount ? `${f.label}: ${f.amount}` : `${f.label} (amount not stated)`));
  if (included.length) out.push(`rent includes ${included.join(', ')}`);
  if (extra.length) out.push(`paid on top of rent: ${extra.join('; ')}`);
  return out;
}

/**
 * The terms as a model is given them: what the ad states, when it was read,
 * and what it leaves out. The model answers from the first line and, for
 * anything on the second, says the ad does not say - and that a viewing
 * request has us ask the agent.
 */
export function termsForPrompt(t: StoredTerms | null): string {
  const stated = describeTerms(t);
  const missing = unknownTerms(t).map((k) => TERM_NAMES[k]);
  const lines: string[] = [];
  if (stated.length > 0) {
    lines.push(`Terms the ad states (read ${dayLabel(t!.readAt.slice(0, 10))}): ${stated.join('; ')}.`);
  }
  if (missing.length > 0) lines.push(`Not stated in the ad: ${missing.join(', ')}.`);
  return lines.join(' ');
}

/**
 * What the agent told us about the same terms (LEASE_TERMS_RECORDED), for the
 * same prompts: dated, and given as the agent's word, which stands over the
 * ad's where the two differ. Empty when nothing was recorded.
 */
export function agentTermsForPrompt(t: (LeaseTerms & { recordedAt: string }) | null | undefined): string {
  const stated = describeTerms(t ?? null);
  return stated.length > 0 ? `The agent told us (${dayLabel(t!.recordedAt.slice(0, 10))}): ${stated.join('; ')}.` : '';
}

// ── Asking the agent ─────────────────────────────────────────────────────────

const ASK_VI: Record<AskableTerm, string> = {
  DEPOSIT: 'cọc mấy tháng',
  MIN_LEASE: 'hợp đồng tối thiểu bao lâu',
  PETS: 'có cho nuôi thú cưng không',
  FEES: 'phí quản lý, điện nước tính thế nào',
};

/**
 * The line in the first message to an agent asking what the ad left out
 * (realtor/drafts.ts). Null when the ad said all four - nothing to ask.
 */
export function askAgentVi(unknown: readonly AskableTerm[]): string | null {
  const asks = ASKABLE_TERMS.filter((k) => unknown.includes(k)).map((k) => ASK_VI[k]);
  if (asks.length === 0) return null;
  const list = asks.length === 1 ? asks[0] : `${asks.slice(0, -1).join(', ')} và ${asks[asks.length - 1]}`;
  return `Anh/chị cho em hỏi thêm: ${list} ạ?`;
}
