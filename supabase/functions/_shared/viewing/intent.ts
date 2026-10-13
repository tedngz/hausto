// What the renter's reply means, over a closed set.
//
// PLAN-v3 is explicit that the WhatsApp side is "intent classification over a
// closed set, then route" - not open-ended conversation. So this returns one of
// six labels and never a sentence.
//
// Rules, not a model, and that is a cost decision as much as a latency one:
// from 2026-10-01 every service message inside the window is billed, so an
// inbound "yes" that costs an LLM call to understand is a line item on a reply
// that was always going to be one word. The escape hatch is UNKNOWN, which
// routes to a human rather than guessing - and the corpus of UNKNOWNs is what
// says whether a model is ever worth adding.
//
// Vietnamese and English both, because a renter in Ho Chi Minh City writes
// either and often both in one message.

import { isOptOut } from '../whatsapp/inbound.ts';
import { looksLikeSelection } from './selection.ts';

export const INTENTS = [
  'CONFIRM',
  'DECLINE',
  'RESCHEDULE',
  'QUESTION',
  // Picking from a list we sent - "2", "1 and 3", "the second one".
  // renderNoSupply ends with "reply with a number", so this is an affordance
  // we promised before we read it; search results are numbered, and get
  // picked from too (agent.ts SEARCH_PICK).
  'SELECTION',
  // Describing what they are looking for, not asking about something we
  // already sent. Deliberately narrow - see SEARCH_SIGNALS.
  'SEARCH',
  'OPT_OUT',
  'UNKNOWN',
] as const;
export type Intent = typeof INTENTS[number];

/**
 * Strip Vietnamese diacritics for matching only.
 *
 * Never for storage or display - `location_normalized` deletes accents rather
 * than folding them and cannot be matched against (SPEC §0), which is the
 * mistake this avoids by folding to the base letter instead of dropping it.
 */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Whole-message matches. A keyword found inside a sentence means nothing. */
const EXACT: [Intent, string[]][] = [
  ['CONFIRM', ['yes', 'y', 'ok', 'okay', 'oke', 'confirm', 'confirmed', 'sounds good', 'perfect',
               'dong y', 'duoc', 'duoc a', 'ok a', 'vang', 'u', 'um', 'chot', 'chot don']],
  ['DECLINE', ['no', 'n', 'nope', 'cancel', 'not interested', 'khong', 'ko', 'k', 'khong can',
               'thoi', 'huy het']],
];

/** Phrases that decide an intent wherever they appear in the message. */
const CONTAINS: [Intent, string[]][] = [
  ['RESCHEDULE', ['reschedule', 'another time', 'different time', 'change the time', 'can we move',
                  'move it', 'earlier', 'later', 'doi gio', 'doi lich', 'gio khac', 'hom khac',
                  'ngay khac', 'chuyen sang']],
  ['DECLINE', ['not interested', 'no longer looking', 'found a place', 'khong quan tam',
               'tim duoc roi', 'thue roi']],
  ['CONFIRM', ['see you then', 'i will be there', 'see you there', 'minh se den', 'em se den']],
];

/**
 * Phrases that mean "find me something", as opposed to "tell me about the
 * thing you already sent".
 *
 * This has to be narrow. QUESTION is the tempting trigger and it is the wrong
 * one: "what floor is it on" is a question, and answering it with three
 * unrelated flats is worse than not answering. So a search needs the renter to
 * actually describe a want - a verb of seeking, or a budget, or a district
 * paired with one.
 */
const SEEKING = [
  'looking for', 'do you have', 'any ', 'anything', 'show me', 'find me',
  'what else', 'other options', 'alternatives',
  'tim ', 'can thue', 'muon thue', 'co can nao', 'con can nao', 'goi y',
];

/** A budget, in any of the ways a renter writes one. */
const BUDGET = /\b\d{1,3}\s*(tr|trieu|m|million|k)\b|\b\d{7,9}\b|\bunder\s*\d|\bduoi\s*\d/;

const QUESTION_WORDS = [
  'what', 'when', 'where', 'which', 'how', 'why', 'can i', 'can you', 'do you',
  // Existential and "does it" forms. Added because "is there parking" carries
  // no question mark and matched nothing, so it landed in UNKNOWN - the same
  // routing, but a worse label in the corpus these events exist to produce.
  'is it', 'is there', 'are there', 'are they', 'does it', 'do they', 'has it',
  'bao nhieu', 'khi nao', 'o dau', 'the nao', 'co the', 'duoc khong', 'bao gio', 'may gio', 'co ... khong',
];

export interface Classification {
  intent: Intent;
  /** Why, for the log. Never shown to a renter. */
  reason: string;
}

/**
 * Classify one inbound message.
 *
 * Order matters and is deliberate: opt-out beats everything (it is a legal
 * instruction, not a preference), an explicit reschedule beats a bare "yes" in
 * the same message, and a question mark loses to a clear answer - "yes, what
 * time?" is a confirmation with a question attached, and routing it as a
 * question would leave the viewings unheld.
 */
export function classifyIntent(raw: string): Classification {
  // Opt-out FIRST, and against the raw text, because folding destroys the
  // only thing that separates `dừng` ("stop") from `đúng` ("that's right").
  // One list, in inbound.ts, so the webhook and this cannot disagree about
  // what an opt-out is.
  if (isOptOut(raw)) return { intent: 'OPT_OUT', reason: 'opt-out keyword' };

  const text = fold(String(raw ?? ''));
  if (!text) return { intent: 'UNKNOWN', reason: 'empty' };

  for (const [intent, words] of EXACT) {
    if (words.includes(text)) return { intent, reason: `exact:${text}` };
  }

  for (const [intent, phrases] of CONTAINS) {
    const hit = phrases.find(p => text.includes(p));
    if (hit) return { intent, reason: `phrase:${hit}` };
  }

  // After the phrase rules, so "can we move it to 3pm" stays a reschedule
  // rather than becoming a pick of listing three. `looksLikeSelection` is
  // deliberately strict about what counts: a false positive arranges viewings
  // nobody asked for, a false negative goes to an operator who reads one line.
  if (looksLikeSelection(raw)) {
    return { intent: 'SELECTION', reason: 'numbered pick' };
  }

  // A leading yes or no with more after it. "yes please, 3pm works" is a
  // confirmation; "no, the second one is too far" is not.
  const leading = text.match(/^(yes|yeah|yep|ok|oke|okay|dong y|duoc|vang|chot)\b/);
  if (leading) return { intent: 'CONFIRM', reason: `leading:${leading[1]}` };
  const leadingNo = text.match(/^(no|nope|khong|ko)\b/);
  if (leadingNo) return { intent: 'DECLINE', reason: `leading:${leadingNo[1]}` };

  // Before QUESTION, because most searches are phrased as questions ("do you
  // have anything in district 2 under 15tr?") and routing those to an operator
  // wastes the one thing the agent is actually good at.
  const seeking = SEEKING.find(p => text.includes(p));
  const hasBudget = BUDGET.test(text);
  if (seeking || hasBudget) {
    // A budget alone is enough only when the message is short - "we agreed 15tr
    // last week, has that changed" is not a search.
    if (seeking || text.length <= 60) {
      return { intent: 'SEARCH', reason: seeking ? `seeking:${seeking.trim()}` : 'budget mentioned' };
    }
  }

  if (text.includes('?') || QUESTION_WORDS.some(q => text.includes(q))) {
    return { intent: 'QUESTION', reason: 'interrogative' };
  }

  // Nothing matched. A human reads it - which is the right answer, and the
  // count of these is the evidence for whether a model would earn its cost.
  return { intent: 'UNKNOWN', reason: 'no rule matched' };
}

/**
 * Phrases that change a search we just answered: an area, a size, a budget,
 * or a comparative. Matched against the folded text.
 */
const REFINEMENT = [
  /\b(district|quan|q)\s*\.?\s*\d{1,2}\b/,
  /\bd\d{1,2}\b/,
  /\b(thao dien|an phu|binh thanh|phu nhuan|tan binh|tan phu|go vap|thu duc|binh tan|nha be|phu my hung|thu thiem)\b/,
  /\b\d\s*(br|bed|beds|bedroom|bedrooms|pn|phong ngu)\b/,
  /\bstudio\b/,
  /\b(cheaper|bigger|smaller|larger|more space|higher budget|lower budget|re hon|rong hon|lon hon)\b/,
];

/**
 * Does this message change the search we just sent results for?
 *
 * Only ever asked within `SEARCH_SESSION_MINUTES` of results (agent.ts), and
 * only of a message that matched no stronger rule. "What about district 7?"
 * reads as a question, and an operator would answer it with exactly the
 * search the agent can run; "is there parking?" matches nothing here and
 * still goes to a person. Narrow for the same reason SEEKING is.
 */
export function looksLikeRefinement(raw: string): boolean {
  const text = fold(String(raw ?? ''));
  return text.length > 0 && text.length <= 120 && (BUDGET.test(text) || REFINEMENT.some(r => r.test(text)));
}

/**
 * Does this intent need a person?
 *
 * CONFIRM is the only one the system finishes on its own. Everything else -
 * including a question we could probably answer - goes to the operator,
 * because the cost of a wrong automated reply inside a billed window is higher
 * than the cost of an operator reading one line.
 */
export function needsOperator(intent: Intent): boolean {
  return intent !== 'CONFIRM' && intent !== 'OPT_OUT';
}
