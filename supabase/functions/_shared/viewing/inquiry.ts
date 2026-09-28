// A concierge availability request, answered on WhatsApp (SPEC §11).
//
// "Check availability at Empire City" is a person's job: someone on our team
// asks the agents who hold units in that building and comes back with what is
// really free. The crawl only knows what was advertised, and for most
// buildings that is nothing this month - which is why the request, not an
// automated alert, is the main thing the complex page offers.
//
// The WhatsApp half borrows the complex watch's handshake. The renter sends
// us a code, which proves the number is theirs and opens the 24-hour service
// window - the window the concierge's "within 24 hours" is measured against.
// The same code turns on a watch with the same criteria, so a building with
// nothing free today still reaches them when something is listed.
//
// Pure. The I/O lives in concierge.ts, routing.ts and the edge functions.

import { formatVnd, hcmcDate } from './format.ts';
import { MAX_BEDROOMS, MAX_BUDGET_VND, MAX_MOVE_IN_DAYS, MIN_BUDGET_VND } from './watch.ts';
import { INQUIRY_CHANNELS, type InquiryChannel } from '../viewing-domain.ts';

export const LEASE_MONTHS = [6, 12, 24] as const;
export const MAX_NOTES = 1000;
export const MAX_NAME = 80;

/** How long after our last message a reply still belongs to the request. */
export const INQUIRY_REPLY_DAYS = 14;

/** The promise the page makes, and the length of the service window. */
export const CONCIERGE_REPLY_HOURS = 24;

const DAY_MS = 86_400_000;

export interface InquiryInput {
  complexId: string;
  name: string;
  moveInDate: string;
  leaseMonths: number;
  /** 1-4, where 4 means four or more. */
  bedrooms: number;
  budgetMaxVnd: number;
  hasPets: boolean;
  notes: string | null;
  channel: InquiryChannel;
  /** Required for EMAIL; kept when given for WHATSAPP, as a fallback. */
  email: string | null;
}

export type InquiryValidation = { ok: true; value: InquiryInput } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// deno-lint-ignore no-explicit-any
export function validateInquiryInput(raw: any, now: Date): InquiryValidation {
  const complexId = String(raw?.complexId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(complexId)) return { ok: false, error: 'Unknown building.' };

  const name = String(raw?.name ?? '').trim().slice(0, MAX_NAME);
  if (!name) return { ok: false, error: 'Tell us your name.' };

  const moveIn = raw?.moveInDate;
  if (typeof moveIn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(moveIn) || Number.isNaN(Date.parse(moveIn))) {
    return { ok: false, error: 'Pick a move-in date.' };
  }
  if (moveIn < hcmcDate(now)) return { ok: false, error: 'Move-in date is in the past.' };
  if (moveIn > hcmcDate(new Date(now.getTime() + MAX_MOVE_IN_DAYS * DAY_MS))) {
    return { ok: false, error: 'Move-in date is more than six months away.' };
  }

  const lease = raw?.leaseMonths;
  if (!(LEASE_MONTHS as readonly number[]).includes(lease)) return { ok: false, error: 'Pick a lease length.' };

  const bedrooms = raw?.bedrooms;
  if (!(Number.isInteger(bedrooms) && bedrooms >= 1 && bedrooms <= MAX_BEDROOMS)) {
    return { ok: false, error: 'Pick a number of bedrooms.' };
  }

  const budget = raw?.budgetMaxVnd;
  if (!(Number.isInteger(budget) && budget >= MIN_BUDGET_VND && budget <= MAX_BUDGET_VND)) {
    return { ok: false, error: `Budget must be between ${formatVnd(MIN_BUDGET_VND)} and ${formatVnd(MAX_BUDGET_VND)} a month.` };
  }

  const channel = raw?.channel;
  if (!(INQUIRY_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: 'Pick how we reply.' };

  const emailRaw = String(raw?.email ?? '').trim();
  const email = emailRaw ? emailRaw : null;
  if (email && !EMAIL.test(email)) return { ok: false, error: 'That email address does not look right.' };
  if (channel === 'EMAIL' && !email) return { ok: false, error: 'Enter the email we should reply to.' };

  const notes = String(raw?.notes ?? '').trim().slice(0, MAX_NOTES) || null;

  return {
    ok: true,
    value: {
      complexId, name, moveInDate: moveIn, leaseMonths: lease, bedrooms, budgetMaxVnd: budget,
      hasPets: raw?.hasPets === true, notes, channel, email,
    },
  };
}

/**
 * The wa.me link at the end of the form. Same handshake as the watch link
 * (watch.ts), worded as what the renter is actually asking for.
 */
export function buildInquiryLink(businessPhoneE164: string, code: string, complexName: string): string {
  const number = businessPhoneE164.replace(/[^0-9]/g, '');
  const text = `Hi Hausto - please check availability at ${complexName} for me (${code})`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

// ── The words ───────────────────────────────────────────────────────────────

export interface InquirySummary {
  fullName: string;
  complexName: string;
  bedrooms: number;
  budgetMaxVnd: number | null;
  moveInDate: string;
  leaseMonths: number;
  hasPets: boolean;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || 'there';
}

function dayMonth(isoOrDate: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate) ? `${isoOrDate}T12:00:00+07:00` : isoOrDate;
  return new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' });
}

/** `2 bedrooms, up to 25.000.000 ₫ a month, moving in from 15 Nov, 12-month lease, with a pet`. */
export function describeInquiry(s: InquirySummary): string {
  return [
    s.bedrooms >= MAX_BEDROOMS ? `${MAX_BEDROOMS}+ bedrooms` : s.bedrooms === 1 ? '1 bedroom' : `${s.bedrooms} bedrooms`,
    s.budgetMaxVnd != null ? `up to ${formatVnd(s.budgetMaxVnd)} a month` : null,
    `moving in from ${dayMonth(s.moveInDate)}`,
    `${s.leaseMonths}-month lease`,
    s.hasPets ? 'with a pet' : null,
  ].filter(Boolean).join(', ');
}

/**
 * The answer to the code, when it belongs to a request.
 *
 * One message, because it is the first of the two the consecutive-outbound
 * rule allows before the renter says anything: it has to say what we heard,
 * who is doing what by when, and that alerts come too.
 */
export function renderInquiryConfirmed(s: InquirySummary & { watchExpiresAt: string }): string {
  return [
    `Thanks ${firstName(s.fullName)} - your request for ${s.complexName} is in: ${describeInquiry(s)}.`,
    `Someone on our team is asking the agents who hold units there now, and will reply here within ${CONCIERGE_REPLY_HOURS} hours.`,
    `Until ${dayMonth(s.watchExpiresAt)} we will also message you when a new listing there fits. Reply STOP any time.`,
  ].join('\n\n');
}

/** When a WhatsApp request's free-form window shuts, from the renter's last message. */
export function windowClosesAt(lastInboundAt: string | null): Date | null {
  if (!lastInboundAt) return null;
  return new Date(Date.parse(lastInboundAt) + CONCIERGE_REPLY_HOURS * 3_600_000);
}
