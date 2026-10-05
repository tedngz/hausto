// Getting a Pass holder's new places to their WhatsApp (pricing rework, step 4).
//
// The digest arrives unbidden, so it needs its own consent, and it can only go
// to a number. Two gaps, two pieces:
//
//   * **The opt-in, before checkout.** A box on our page, never Polar's,
//     unticked by default. Recorded on the account (`account_digest_opt_ins`)
//     and on every number already linked to it (`renters.digest_opt_in_at`,
//     which is what the sweep reads).
//   * **The link, after purchase.** Only 2 of 10 accounts had a WhatsApp number
//     linked (2026-10-04), and a Pass bought by any other account has nobody
//     to send to. The success page offers a wa.me link carrying a one-off code
//     (`HL-4KX2`); the message it sends proves the number, links it to the
//     account, and carries the account's opt-in onto it.
//
// A number already linked to another account is never moved: a code is not a
// credential to be passed around (the same rule as watch codes).

import { REF_ALPHABET } from './intake.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/** A link code lasts a week - long enough to find the phone, short enough not to linger. */
export const LINK_CODE_DAYS = 7;

export function generateLinkCode(random: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < 4; i++) body += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return `HL-${body}`;
}

/** Pull a link code out of an inbound message. */
export function linkCodeFromMessage(body: string): string | null {
  const m = String(body ?? '').toUpperCase().match(new RegExp(`HL-[${REF_ALPHABET}]{4}`));
  return m ? m[0] : null;
}

/** The wa.me link the success page offers. */
export function buildLinkDeepLink(businessPhoneE164: string, code: string): string {
  const number = businessPhoneE164.replace(/[^0-9]/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(`Hi Hausto - link my account (${code})`)}`;
}

/** Record the account's consent, and carry it onto every number already linked. */
export async function recordDigestOptIn(db: Supa, userId: string, now: Date): Promise<void> {
  const at = now.toISOString();
  await db.from('account_digest_opt_ins').upsert({ user_id: userId, opted_in_at: at }, { onConflict: 'user_id' });
  // A number that said STOP has said it about everything; ticking a box on the
  // website does not undo that.
  await db.from('renters').update({ digest_opt_in_at: at })
    .eq('user_id', userId).is('digest_opt_in_at', null).is('opted_out_at', null);
}

/** Does this account have a WhatsApp number we can reach? */
export async function hasLinkedNumber(db: Supa, userId: string): Promise<boolean> {
  const { data } = await db.from('renters').select('id').eq('user_id', userId).limit(1).maybeSingle();
  return !!data;
}

/** The account's live link code, or a new one. */
export async function linkCodeFor(db: Supa, userId: string, now: Date): Promise<string> {
  const { data: existing } = await db
    .from('account_link_codes')
    .select('code, expires_at')
    .eq('user_id', userId)
    .is('used_at', null)
    .gt('expires_at', now.toISOString())
    .limit(1)
    .maybeSingle();
  if (existing?.code) return String(existing.code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    const { error } = await db.from('account_link_codes').insert({
      code,
      user_id: userId,
      expires_at: new Date(now.getTime() + LINK_CODE_DAYS * 86_400_000).toISOString(),
    });
    if (!error) return code;
    if (error.code !== '23505') throw new Error(`link code failed: ${error.message ?? error}`);
  }
  throw new Error('link code collision');
}

export type LinkOutcome =
  | { kind: 'LINKED'; digestOptIn: boolean }
  | { kind: 'PROBLEM'; problem: 'UNKNOWN' | 'EXPIRED' | 'OTHER_ACCOUNT' };

/**
 * The code arrived from this number: link it to the account, once.
 *
 * Idempotent on redelivery - the same code from the same number links again
 * and says so. The same code from a different number, or a number already
 * linked to another account, is refused rather than moved.
 */
export async function linkAccount(
  db: Supa,
  code: string,
  renter: { id: string; user_id?: string | null; opted_out_at: string | null },
  now: Date,
): Promise<LinkOutcome> {
  const { data: row } = await db
    .from('account_link_codes')
    .select('code, user_id, expires_at, used_at, renter_id')
    .eq('code', code)
    .maybeSingle();
  if (!row) return { kind: 'PROBLEM', problem: 'UNKNOWN' };
  if (row.used_at && row.renter_id !== renter.id) return { kind: 'PROBLEM', problem: 'UNKNOWN' };
  if (!row.used_at && Date.parse(String(row.expires_at)) <= now.getTime()) return { kind: 'PROBLEM', problem: 'EXPIRED' };

  const { data: current } = await db.from('renters').select('user_id').eq('id', renter.id).maybeSingle();
  const linkedTo = (current?.user_id as string | null | undefined) ?? renter.user_id ?? null;
  if (linkedTo && linkedTo !== row.user_id) return { kind: 'PROBLEM', problem: 'OTHER_ACCOUNT' };

  if (!linkedTo) await db.from('renters').update({ user_id: row.user_id }).eq('id', renter.id).is('user_id', null);
  if (!row.used_at) {
    await db.from('account_link_codes').update({ used_at: now.toISOString(), renter_id: renter.id }).eq('code', code);
  }

  const { data: consent } = await db
    .from('account_digest_opt_ins').select('opted_in_at').eq('user_id', row.user_id).maybeSingle();
  const digestOptIn = !!consent && !renter.opted_out_at;
  if (digestOptIn) {
    await db.from('renters').update({ digest_opt_in_at: String(consent.opted_in_at) })
      .eq('id', renter.id).is('digest_opt_in_at', null);
  }
  return { kind: 'LINKED', digestOptIn };
}

/** The one reply to a link code. */
export function renderLinkOutcome(outcome: LinkOutcome): string {
  if (outcome.kind === 'LINKED') {
    return outcome.digestOptIn
      ? 'Your WhatsApp is linked to your Hausto account. While your Pass runs we send new places that fit you here, up to twice a week. Reply STOP any time to end them.'
      : 'Your WhatsApp is linked to your Hausto account. Plans for your viewing requests come here.';
  }
  if (outcome.problem === 'EXPIRED') {
    return 'That code has expired - codes last a week. Open your Hausto account and tap the WhatsApp link again.';
  }
  if (outcome.problem === 'OTHER_ACCOUNT') {
    return 'This number is already linked to another Hausto account, so we left it as it is. Reply here if that is not right.';
  }
  return 'We could not find that code. Open your Hausto account and tap the WhatsApp link again.';
}
