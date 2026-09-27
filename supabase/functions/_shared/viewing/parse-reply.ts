// Paste-parse: an agent's Zalo reply, read into a suggested outcome (SPEC §4,
// PLAN-v3 S5, gap 8 in the AI operator plan).
//
// Interpretation is the slow part of an operator's day, not typing. The
// operator pastes what the agent wrote; this returns what one of the seven
// outcomes it most likely is, with the times and price filled in. It is a
// suggestion and nothing else: the console fills the form, the operator reads
// it and presses Record, and the model never writes an event.
//
// The division of labour is the design. The model is asked what the agent
// SAID - available at these times, rented, a different price, a wrong number -
// in the agent's own terms, with relative dates resolved. Deterministic code
// here decides which outcome that is, because two of the rules are ours and
// not the model's to apply:
//
//   - a slot inside the renter's windows is CONFIRMED; outside them it is
//     ALTERNATIVE_OFFERED (`withinWindows`, shared with the console);
//   - a quoted price meaningfully different from the one the renter was shown
//     is PRICE_CHANGED, which is terminal and slotless, whatever times came
//     with it.
//
// Pure, so it is tested without a model. The edge function (ops-parse-reply)
// is the I/O around it.

import { OUTCOMES, validateOutcome, type Outcome, type Slot } from './outcomes.ts';
import { withinWindows, DAY_PART_HOURS, type DayPart } from './intake.ts';

/** Same house model as the other extraction calls - this is five fields from a paragraph. */
export const PARSE_MODEL = 'gpt-4o-mini';

/** Replies longer than this are a paste gone wrong, and cost money to read. */
export const MAX_REPLY_CHARS = 2000;

/**
 * A quoted price within this fraction of the listed one is the same price said
 * roughly - "18tr" against a listed 18.250.000. Beyond it, it is a new price.
 */
export const PRICE_TOLERANCE = 0.03;

/** What the model is asked to say. Its own vocabulary, mapped to ours below. */
export const READINGS = ['AVAILABLE', 'NOT_AT_THOSE_TIMES', 'ALREADY_RENTED', 'WRONG_PERSON', 'UNCLEAR'] as const;
export type Reading = typeof READINGS[number];

export interface ParseContext {
  reply: string;
  listingTitle: string;
  /** What the renter was shown, integer dong. */
  priceVnd: number;
  availability: { date: string; part: string }[];
  now: Date;
}

export interface ParseSuggestion {
  /** Null when the reply settles nothing - save it and wait. */
  outcome: Outcome | null;
  slots: Slot[];
  actualPriceVnd: number | null;
  /** One English line for the operator's note. Never parsed. */
  note: string;
  confidence: 'HIGH' | 'LOW';
  /** Why the operator should look twice. Empty when there is nothing to flag. */
  problems: string[];
  model: string;
}

export const PARSE_PROMPT = `You read one reply from a Vietnamese real-estate agent (môi giới) on Zalo.
We had asked the agent whether a rental unit is still available and when a client could view it.
Report what the agent said. Do not guess beyond the words.

Return JSON only:
{
  "reading": "AVAILABLE" | "NOT_AT_THOSE_TIMES" | "ALREADY_RENTED" | "WRONG_PERSON" | "UNCLEAR",
  "times": ["YYYY-MM-DD HH:mm"],
  "duration_minutes": number | null,
  "price_vnd": integer | null,
  "summary": "one short English sentence saying what the agent said",
  "confident": true | false
}

reading:
- AVAILABLE: the unit is available and the agent agreed to, or proposed, at least one viewing time. Put every time they agreed to or proposed in "times".
- NOT_AT_THOSE_TIMES: the unit is available but the agent cannot do the client's times and names no other specific time ("tuần này anh bận", "để hôm khác").
- ALREADY_RENTED: the unit is taken or no longer for rent ("cho thuê rồi", "có khách rồi", "đã cọc", "hết phòng").
- WRONG_PERSON: wrong number, not the agent, or does not know the unit ("nhầm số", "không phải", "không biết căn nào").
- UNCLEAR: anything else - a question back, "để anh hỏi chủ nhà", a greeting, a reply that settles nothing.

times: local Ho Chi Minh City time, 24-hour, resolved against "Today" below to the next matching date on or after today.
- thứ 2 = Monday ... thứ 7 = Saturday, chủ nhật / CN = Sunday; mai = tomorrow; mốt = the day after tomorrow; tuần sau = next week.
- "10h" = 10:00, "10h30" = 10:30, "3h chiều" = 15:00, "7h tối" = 19:00, "sáng" = morning, "chiều" = afternoon, "tối" = evening.
- If the agent says a part of the day without a clock time ("sáng thứ 7 được"), use its start: morning 09:00, afternoon 14:00, evening 18:00.
- If the agent agrees to the client's proposed windows without naming one ("được em", "ok em, qua lúc nào cũng được"), put the first of the client's windows, at its start time.
- Leave "times" empty when no time is named or implied.

price_vnd: the monthly rent the agent quoted in this reply, as an integer in dong. "tr" / "triệu" = million, "15tr5" = 15500000, "15,5tr" = 15500000, "k" = thousand. Null when no price is mentioned, or when it is quoted in another currency.

confident: false if the reply is ambiguous, sarcastic, or you had to guess a date.`;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `YYYY-MM-DD` and weekday of a UTC instant, in Ho Chi Minh City. */
function localDay(t: number): { date: string; weekday: string } {
  const local = new Date(t + 7 * 60 * 60 * 1000);
  return { date: local.toISOString().slice(0, 10), weekday: WEEKDAY[local.getUTCDay()] };
}

/** The user turn: the facts the model resolves the reply against. No renter details - there are none to give. */
export function buildParseInput(ctx: ParseContext): string {
  const today = localDay(ctx.now.getTime());
  const windows = ctx.availability.map(w => {
    const d = localDay(Date.parse(`${w.date}T12:00:00+07:00`));
    const h = DAY_PART_HOURS[w.part as DayPart];
    const range = h ? ` (${String(h.from).padStart(2, '0')}:00-${String(h.to).padStart(2, '0')}:00)` : '';
    return `- ${d.weekday} ${w.date} ${w.part.toLowerCase()}${range}`;
  });
  return [
    `Today: ${today.weekday} ${today.date} (Asia/Ho_Chi_Minh)`,
    `Unit: ${ctx.listingTitle}`,
    `Price we listed: ${ctx.priceVnd} VND per month`,
    'Client is free:',
    ...(windows.length ? windows : ['- (no windows given)']),
    '',
    'Agent reply:',
    '"""',
    ctx.reply.slice(0, MAX_REPLY_CHARS),
    '"""',
  ].join('\n');
}

/** `2026-10-03 10:30` in Ho Chi Minh City to a UTC instant, or null. */
function parseLocalTime(s: unknown): string | null {
  const m = String(s ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, date, hh, mm] = m;
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  const t = Date.parse(`${date}T${hh.padStart(2, '0')}:${mm}:00+07:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** How far ahead a named time is believable. Beyond this the model misread a date. */
const MAX_DAYS_OUT = 30;

/**
 * The model's reading, turned into a suggestion the console can fill in.
 *
 * Never throws on what the model returned: a malformed answer becomes a LOW
 * confidence suggestion with nothing filled in, which costs the operator the
 * same thirty seconds it cost before this existed.
 */
export function interpretParse(raw: unknown, ctx: ParseContext): ParseSuggestion {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const reading = (READINGS as readonly string[]).includes(String(r.reading)) ? r.reading as Reading : 'UNCLEAR';
  const summary = typeof r.summary === 'string' ? r.summary.trim().slice(0, 300) : '';
  const duration = Number.isInteger(r.duration_minutes) && (r.duration_minutes as number) >= 15
    && (r.duration_minutes as number) <= 240 ? r.duration_minutes as number : 30;

  // Times: parsed, then checked against the calendar. A time in the past or a
  // month out is a misread date, and filling it in would put a wrong viewing
  // one click from the log.
  const now = ctx.now.getTime();
  const times: string[] = [];
  for (const t of Array.isArray(r.times) ? r.times.slice(0, 6) : []) {
    const iso = parseLocalTime(t);
    if (!iso) { problems.push(`Could not read the time "${String(t)}".`); continue; }
    const at = Date.parse(iso);
    if (at < now) { problems.push(`The agent's time ${String(t)} is in the past - check the date.`); continue; }
    if (at > now + MAX_DAYS_OUT * 86_400_000) { problems.push(`${String(t)} is over a month out - check the date.`); continue; }
    if (!times.includes(iso)) times.push(iso);
  }

  const quoted = Number.isInteger(r.price_vnd) && (r.price_vnd as number) > 0 ? r.price_vnd as number : null;
  const priceMoved = quoted != null && ctx.priceVnd > 0
    && Math.abs(quoted - ctx.priceVnd) / ctx.priceVnd > PRICE_TOLERANCE;

  let outcome: Outcome | null;
  let slots: Slot[] = [];
  let actualPriceVnd: number | null = null;

  if (reading === 'ALREADY_RENTED') {
    outcome = 'ALREADY_RENTED';
  } else if (reading === 'WRONG_PERSON') {
    outcome = 'UNREACHABLE';
  } else if (priceMoved && (reading === 'AVAILABLE' || reading === 'NOT_AT_THOSE_TIMES')) {
    // A new price wins over any time offered with it. PRICE_CHANGED carries
    // no slot (SPEC §4): the renter agreed to a price, and a viewing at a
    // different one is a new question for them, not a line in this plan.
    outcome = 'PRICE_CHANGED';
    actualPriceVnd = quoted;
    if (times.length > 0) problems.push('The agent also offered times - they are in the note, not the outcome.');
  } else if (reading === 'AVAILABLE') {
    const inside = times.filter(t => withinWindows(t, ctx.availability));
    if (inside.length > 0) {
      outcome = 'CONFIRMED';
      slots = inside.map(startsAt => ({ startsAt, durationMinutes: duration }));
      if (inside.length < times.length) problems.push('Some offered times fall outside the renter\'s windows and were left out.');
    } else if (times.length > 0) {
      outcome = 'ALTERNATIVE_OFFERED';
      slots = times.map(startsAt => ({ startsAt, durationMinutes: duration }));
    } else {
      outcome = 'CONFIRMED';
      problems.push('The agent agreed but no time could be read - pick one before recording.');
    }
  } else if (reading === 'NOT_AT_THOSE_TIMES') {
    outcome = 'UNAVAILABLE_DATE';
  } else {
    outcome = null;
    problems.push('This reply does not settle anything - save it and wait, or ask the agent again.');
  }

  // Our own rules, run over the suggestion, so a bad one says why before the
  // operator presses a button that would be refused. The nudge floor is not a
  // question for a reply that exists, so it is waived here.
  if (outcome) {
    const check = validateOutcome(
      { outcome, slots, actualPriceVnd: actualPriceVnd ?? undefined },
      { priorNudges: Number.MAX_SAFE_INTEGER },
    );
    if (!check.ok && !problems.length) problems.push(check.error);
  }

  const note = [
    summary,
    priceMoved && times.length > 0 ? `Times offered: ${(r.times as unknown[]).join(', ')}.` : '',
    !priceMoved && quoted != null && quoted !== ctx.priceVnd ? `Quoted ${quoted} VND, within ${PRICE_TOLERANCE * 100}% of listed.` : '',
  ].filter(Boolean).join(' ');

  return {
    outcome: outcome && (OUTCOMES as readonly string[]).includes(outcome) ? outcome : null,
    slots,
    actualPriceVnd,
    note,
    confidence: r.confident === true && problems.length === 0 && outcome != null ? 'HIGH' : 'LOW',
    problems,
    model: PARSE_MODEL,
  };
}
