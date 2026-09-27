// The rents a listing's own words mention (SPEC §0 `price_confidence`, PLAN-v3
// S3).
//
// `price_vnd` comes from one field - the extraction step's `price`, the chotot
// payload, the housingsgn price box. The title and description are a second
// witness, and when the two disagree the stored price is the one to doubt: a
// 60 triệu duplex was stored at 70M because extraction read a number off a
// "similar listings" panel. This finds the figures the text quotes as a
// monthly rent; the database decides what a disagreement means
// (`price_confidence_for`), so the rule has one home and applies on every
// write, whoever makes it.
//
// Built to under-report. A figure it misses costs nothing - the listing keeps
// the confidence it had. A figure it invents can make a real listing
// unrequestable. So a clause that talks about a deposit, a fee, a utility, a
// nightly or yearly rate, a price per square metre, or a sale is skipped
// whole, and a bare number counts only beside a currency or a word for rent.
//
// Titles and descriptions are mostly English by the time they are stored
// (extraction writes English; nhatot's seller text is rewritten), but a
// Vietnamese one can still arrive, so both are read.

/** The rate `canonical_price_vnd` converts housingsgn's USD at. */
export const USD_TO_VND = 25_000;

/** Nothing outside this is read as a monthly rent. The ceiling is
 *  `price_confidence_for`'s; the floor sits above its 1M, because a figure
 *  near a million in an advert is far more often a fee or a discount than a
 *  rent, and missing a real 1.5M rent only leaves that listing unchecked. */
export const MENTION_FLOOR_VND = 2_000_000;
export const MENTION_CEILING_VND = 500_000_000;

/** Lowercase, accents folded: "Giá 16 triệu/tháng" -> "gia 16 trieu/thang". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

// A sentence, a line, a bullet, or a comma-separated phrase: small enough that
// "rent 16 million, deposit 32 million" keeps the deposit away from the rent.
// Decimal points ("16.5") and grouped thousands ("16.000.000", "16,000,000")
// are not followed by a space, so they survive, and a dash after a number is
// a range ("12 - 15 triệu"), not a break.
const CLAUSE_BREAK = /(?:\r?\n)+|[;!?•|]+|\.(?=\s|$)|,(?=\s)|(?<!\d)\s[-–—]\s/;

const SKIP_WORDS = [
  // deposit, fees, commission
  'coc', 'dat coc', 'deposit', 'phi', 'fee', 'fees', 'hoa hong', 'commission', 'moi gioi',
  'service charge', 'service', 'dich vu', 'management', 'cleaning', 'don dep',
  // discounts: "giảm 2tr" is off the rent, not the rent
  'giam', 'giam gia', 'discount', 'off', 'khuyen mai', 'uu dai', 'promotion', 'bonus',
  // utilities - not bare "dien", which is also "diện tích", floor area
  'tien dien', 'tien nuoc', 'dien nuoc', 'gia dien', 'gia nuoc',
  'electric', 'electricity', 'water', 'internet', 'wifi', 'utilities', 'utility',
  'parking', 'gui xe',
  // a bound, not the rent: "from 12 million" is a floor, and a floor read as
  // the rent flags every bigger unit in a building's advert
  'from', 'starting', 'tu', 'up to', 'under', 'below', 'above', 'over', 'more than', 'less than',
  'duoi', 'tren', 'hon', 'toi da', 'toi thieu', 'minimum', 'maximum',
  // not a monthly rate
  'per night', 'night', 'nightly', 'dem', 'per day', 'daily', 'per week', 'weekly',
  'per year', 'a year', 'yearly', 'annual', 'annually',
  'per sqm', 'per m2', 'per square',
  // a sale
  'ty', 'billion', 'for sale', 'sale price', 'can ban', 'ban can',
];
const SKIP_WORD = new RegExp(`(?:^|[^a-z])(?:${SKIP_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})(?![a-z])`);
// Rates written with a slash: "/night", "/ngày", "/năm", "/m2".
const SKIP_RATE = /\/\s*(?:dem|ngay|day|night|week|tuan|nam|year|yr|m2|m²|sqm)(?![a-z])/;

const RENT_WORD = /(?:^|[^a-z])(?:gia|gia thue|thue|rent|rental|price|priced|cost|costs)(?![a-z])/;
const CURRENCY_WORD = /(?:^|[^a-z])(?:vnd|dong|d)(?![a-z])|₫/;

/** "16,5" or "16.5" -> 16.5 */
const decimal = (s: string) => Number(s.replace(',', '.'));

/** Dollars to dong. "1,200" and "1.200" are thousands; "1.5" with k is 1500. */
function usd(amount: string, k?: string): number {
  const dollars = /^\d{1,2}[.,]\d{3}$/.test(amount) ? Number(amount.replace(/[.,]/, '')) : decimal(amount);
  return Math.round(dollars * (k ? 1000 : 1) * USD_TO_VND);
}

const NUM = String.raw`\d{1,3}(?:[.,]\d{1,3})?`;
const MILLIONS_UNIT = String.raw`(?:trieu|tr|millions?)(?![a-z\d²])`;

/** Monthly rents in dong that one clause quotes. */
function clauseMentions(clause: string): number[] {
  if (SKIP_WORD.test(clause) || SKIP_RATE.test(clause)) return [];
  const out: number[] = [];

  // Millions by word: "16 triệu", "16tr", "16tr5" (16.5), "16,5 triệu",
  // "16.5 million". A bare "m" is also metres ("82m2", "a 16m frontage"), so it
  // counts only when a currency or a period follows: "16M VND", "16m/month".
  for (const m of clause.matchAll(
    /(?<![\d.,])(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:(trieu|tr)(\d{1,3})?|millions?|mil(?=\s*(?:vnd|dong|d\b|₫|\/|per|a month|month))|m(?=\s*(?:vnd|dong|₫|\/\s*(?:thang|month|mo)\b|per month|a month|monthly)))(?![a-z\d²])/g,
  )) {
    let millions = decimal(m[1]);
    // "16tr5" is 16.5 million, "16tr500" the same.
    if (m[3] && !/[.,]/.test(m[1])) millions += Number(`0.${m[3]}`);
    out.push(Math.round(millions * 1_000_000));
  }
  // The low end of a range, which the unit only follows once: "12-15 triệu",
  // "12 to 15 million". Without it, 12 goes unread and a 12M listing looks
  // like a disagreement with 15.
  for (const m of clause.matchAll(new RegExp(String.raw`(?<![\d.,])(${NUM})\s*(?:-|–|~|to|den)\s*${NUM}\s*${MILLIONS_UNIT}`, 'g'))) {
    out.push(Math.round(decimal(m[1]) * 1_000_000));
  }

  // Dong in full: "16.000.000 VND", "16,000,000đ", "VND 16,000,000". Without a
  // currency beside it a long number could be anything, so it counts then only
  // if the clause says it is a price.
  const priced = CURRENCY_WORD.test(clause) || RENT_WORD.test(clause);
  if (priced) {
    for (const m of clause.matchAll(/(?<![\d.,])(\d{1,3}(?:[.,\s]\d{3}){2,3}|\d{7,9})(?![\d]|[.,]\d)/g)) {
      out.push(Number(m[1].replace(/[.,\s]/g, '')));
    }
  }

  // Dollars: "$730", "$1,200", "$1.2k", "730 USD", "USD 730", "$700-800".
  const USD_AMOUNT = String.raw`(\d{1,2}[.,]\d{3}|\d+(?:[.,]\d+)?)\s*(k)?(?![\d])`;
  for (const m of clause.matchAll(new RegExp(String.raw`(?:\$|usd)\s*${USD_AMOUNT}`, 'g'))) out.push(usd(m[1], m[2]));
  for (const m of clause.matchAll(new RegExp(String.raw`(?:\$|usd)\s*\d[\d.,]*\s*k?\s*(?:-|–|~|to)\s*\$?\s*${USD_AMOUNT}`, 'g'))) out.push(usd(m[1], m[2]));
  for (const m of clause.matchAll(/(?<![\d.,$])(\d{1,2}[.,]\d{3}|\d{2,5})\s*(?:usd|us dollars?|dollars?)(?![a-z])/g)) out.push(usd(m[1]));

  return out.filter((v) => v >= MENTION_FLOOR_VND && v <= MENTION_CEILING_VND);
}

/** Every monthly rent `text` quotes, in dong, in order of appearance. */
export function rentMentionsVnd(text: string | null | undefined): number[] {
  if (!text) return [];
  return fold(text).split(CLAUSE_BREAK).flatMap((c) => (c ? clauseMentions(c) : []));
}

export interface DescribedPrice {
  min_vnd: number;
  max_vnd: number;
}

/**
 * The lowest and highest rent the title and description quote, or null when
 * they quote none. A listing that names two ("1PN 8tr, 2PN 12tr") gets both
 * ends, so a price anywhere between them agrees - the text does not say which
 * unit this is, and guessing is how a real listing gets flagged.
 */
export function describedPrice(title: string | null | undefined, description: string | null | undefined): DescribedPrice | null {
  const all = [...rentMentionsVnd(title), ...rentMentionsVnd(description)];
  if (all.length === 0) return null;
  return { min_vnd: Math.min(...all), max_vnd: Math.max(...all) };
}
