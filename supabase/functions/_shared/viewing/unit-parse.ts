// An agent's answer to an availability check, read into suggested units
// (PLAN-v3 S7.2b, SPEC §11).
//
// "Còn 2 căn 2PN: tầng 18 Linden 82m2 full NT 24tr, tầng 9 Cove 76m2 22tr5,
// trống sẵn" is two listings' worth of fields in one line of Vietnamese
// shorthand, and typing them into the capture form is where an operator's
// time goes. The model reads what the agent SAID; this checks each field the
// way the capture form does, and flags what the operator must still ask for or
// look at. It suggests and never applies: the operator reviews the form it
// fills and presses Add unit, and the model never writes a row or an event -
// the same division as paste-parse (parse-reply.ts).
//
// Pure, so it is tested without a model. ops-parse-reply is the I/O.

import { MAX_BEDROOMS, MAX_BUDGET_VND, MIN_BUDGET_VND } from './watch.ts';
import { FURNISHING, misfit, type Brief, type Furnishing } from './offer.ts';
import { PARSE_MODEL } from './parse-reply.ts';

export const UNIT_PARSE_MODEL = PARSE_MODEL;

/** Units read from one reply - what an agent lists in one message, and one offer's worth. */
export const MAX_SUGGESTED_UNITS = 5;

export const UNIT_ANSWERS = ['HAS_UNITS', 'NO_UNITS', 'UNCLEAR'] as const;
export type UnitAnswer = typeof UNIT_ANSWERS[number];

export interface UnitParseContext {
  reply: string;
  complexName: string;
  /** What may be offered - the form's brief or the renter's change to it. */
  brief: Brief;
  now: Date;
}

export interface SuggestedUnit {
  bedrooms: number | null;
  areaSqm: number | null;
  priceVnd: number | null;
  floor: string | null;
  tower: string | null;
  furnishing: Furnishing | null;
  petsOk: boolean | null;
  availableFrom: string | null;
  /** The words of the reply this unit came from, for the operator to check against. */
  quote: string;
  /** What to ask the agent, or look twice at, before this is a unit. */
  problems: string[];
}

export interface UnitSuggestion {
  answer: UnitAnswer;
  units: SuggestedUnit[];
  /** One English line for the operator. Never parsed. */
  note: string;
  confidence: 'HIGH' | 'LOW';
  model: string;
}

export const UNIT_PARSE_PROMPT = `You read one reply from a Vietnamese real-estate agent (môi giới) on Zalo.
We asked the agent which apartments are available to rent at one building, for a client's brief.
Report the units the agent offered. Never invent a field the agent did not state.

Return JSON only:
{
  "answer": "HAS_UNITS" | "NO_UNITS" | "UNCLEAR",
  "units": [{
    "bedrooms": integer | null,
    "area_sqm": integer | null,
    "price_vnd": integer | null,
    "floor": string | null,
    "tower": string | null,
    "furnishing": "FULL" | "PARTIAL" | "NONE" | null,
    "pets_ok": true | false | null,
    "available_from": "YYYY-MM-DD" | null,
    "quote": "the words of the reply this unit came from"
  }],
  "summary": "one short English sentence saying what the agent said",
  "confident": true | false
}

answer:
- HAS_UNITS: the agent offers one or more units. One entry in "units" per distinct unit.
- NO_UNITS: nothing is available ("hết căn", "không có căn", "full rồi", "chưa có căn").
- UNCLEAR: anything else - a question back, a greeting, "để em check", "(photo)".

Fields:
- bedrooms: "2PN" / "2 phòng ngủ" / "2BR" = 2; "studio" / "1PN" = 1.
- area_sqm: "80m2" / "80m²" / "80 mét" = 80.
- price_vnd: the monthly rent as an integer in dong. "tr" / "triệu" = million, "15tr5" = 15500000, "15,5tr" = 15500000, "k" = thousand. Quoted in US dollars ("$800", "800 đô", "800 USD"): multiply by 25000.
- floor: as written ("18"; "tầng cao" = "high"; "tầng thấp" = "low").
- tower: the block or tower name ("Linden", "tháp A" = "A", "block B" = "B").
- furnishing: "full nội thất" / "đầy đủ nội thất" / "full NT" = FULL; "nội thất cơ bản" / "NTCB" = PARTIAL; "nhà trống" / "không nội thất" = NONE.
- pets_ok: only if the agent said whether pets are allowed.
- available_from: when the unit can be moved into, resolved against "Today" below; "trống sẵn" / "vào ở ngay" = today.

confident: false if the reply is ambiguous or you had to guess any field.`;

/** The user turn. The brief and the building - nothing about who is asking; there is nothing to give. */
export function buildUnitParseInput(ctx: UnitParseContext): string {
  const today = new Date(ctx.now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  const beds = ctx.brief.bedrooms.map(n => (n >= MAX_BEDROOMS ? `${MAX_BEDROOMS}+` : String(n))).join(' or ');
  return [
    `Today: ${today} (Asia/Ho_Chi_Minh)`,
    `Building: ${ctx.complexName}`,
    `We asked for: ${beds} bedrooms${ctx.brief.budgetMaxVnd ? `, up to ${ctx.brief.budgetMaxVnd} VND a month` : ''}`,
    '',
    'Agent reply:',
    ctx.reply,
  ].join('\n');
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const text = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, max) : null;
};

/**
 * The model's JSON, held to what the capture form accepts. A field outside
 * the form's range is dropped and flagged rather than passed on: a price of
 * 24 (million, unscaled) must not reach the form as 24 dong.
 */
export function interpretUnitParse(raw: unknown, ctx: UnitParseContext): UnitSuggestion {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const answer = (UNIT_ANSWERS as readonly string[]).includes(String(r.answer)) ? r.answer as UnitAnswer : 'UNCLEAR';
  const list = Array.isArray(r.units) ? r.units.slice(0, MAX_SUGGESTED_UNITS) : [];

  const units: SuggestedUnit[] = answer !== 'HAS_UNITS' ? [] : list.map(x => {
    const u = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const problems: string[] = [];

    let bedrooms = int(u.bedrooms);
    if (bedrooms != null) bedrooms = bedrooms >= MAX_BEDROOMS ? MAX_BEDROOMS : bedrooms < 1 ? null : bedrooms;
    let areaSqm = int(u.area_sqm);
    if (areaSqm != null && (areaSqm < 15 || areaSqm > 1000)) { problems.push(`floor area ${areaSqm} m² looks wrong`); areaSqm = null; }
    let priceVnd = int(u.price_vnd);
    if (priceVnd != null && (priceVnd < MIN_BUDGET_VND || priceVnd > MAX_BUDGET_VND)) {
      problems.push(`price ${priceVnd} looks wrong`);
      priceVnd = null;
    }
    if (bedrooms == null) problems.push('no bedroom count - ask the agent');
    if (areaSqm == null && !problems.some(p => p.startsWith('floor area'))) problems.push('no floor area - ask the agent');
    if (priceVnd == null && !problems.some(p => p.startsWith('price'))) problems.push('no price - ask the agent');
    if (bedrooms != null && priceVnd != null) {
      const off = misfit({ bedrooms, priceVnd }, ctx.brief);
      if (off) problems.push(`outside the brief: ${off}`);
    }

    const furnishing = (FURNISHING as readonly string[]).includes(String(u.furnishing)) ? u.furnishing as Furnishing : null;
    const from = typeof u.available_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u.available_from)
      && !Number.isNaN(Date.parse(u.available_from)) ? u.available_from : null;
    return {
      bedrooms, areaSqm, priceVnd,
      floor: text(u.floor, 20), tower: text(u.tower, 40), furnishing,
      petsOk: typeof u.pets_ok === 'boolean' ? u.pets_ok : null,
      availableFrom: from,
      quote: text(u.quote, 300) ?? '',
      problems,
    };
  });

  const confident = r.confident === true && units.every(u => u.problems.length === 0);
  return {
    answer: answer === 'HAS_UNITS' && units.length === 0 ? 'UNCLEAR' : answer,
    units,
    note: text(r.summary, 300) ?? '',
    confidence: confident ? 'HIGH' : 'LOW',
    model: UNIT_PARSE_MODEL,
  };
}
