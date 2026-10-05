// Linking a WhatsApp number to an account after a Pass is bought (pricing
// rework, step 4): the code from the success page, sent from the phone, links
// the number once and carries the account's digest opt-in onto it.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { handleInbound } from './routing.ts';
import { decideAction } from './agent.ts';
import {
  buildLinkDeepLink, generateLinkCode, linkCodeFor, linkCodeFromMessage, recordDigestOptIn, renderLinkOutcome,
} from './account-link.ts';

const PHONE = '+447700900123';
const NOW = new Date('2026-10-06T05:00:00Z');
let db: FakeDb;
let store: SupabaseMessageStore;

beforeEach(() => {
  db = new FakeDb();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);
  db.tables.account_link_codes = [];
  db.tables.account_digest_opt_ins = [];
});

const inbound = (text: string, from = PHONE) =>
  // deno-lint-ignore no-explicit-any
  handleInbound(db as any, store, { from, text, providerMessageId: `wamid.${Math.random()}`, timestamp: NOW.toISOString() });

describe('the code', () => {
  it('reads back out of the message the link sends', () => {
    const code = generateLinkCode(() => 0.5);
    const link = buildLinkDeepLink('+84901112222', code);
    expect(link.startsWith('https://wa.me/84901112222?text=')).toBe(true);
    expect(linkCodeFromMessage(decodeURIComponent(link.split('?text=')[1]))).toBe(code);
  });

  it('is reused while it lives', async () => {
    // deno-lint-ignore no-explicit-any
    const a = await linkCodeFor(db as any, 'u1', NOW);
    // deno-lint-ignore no-explicit-any
    const b = await linkCodeFor(db as any, 'u1', NOW);
    expect(a).toBe(b);
  });
});

describe('linking, on the inbound path', () => {
  it('links the number to the account and carries the digest opt-in onto it', async () => {
    // deno-lint-ignore no-explicit-any
    await recordDigestOptIn(db as any, 'u1', NOW);
    // deno-lint-ignore no-explicit-any
    const code = await linkCodeFor(db as any, 'u1', NOW);
    const out = await inbound(`Hi Hausto - link my account (${code})`);
    expect(out.link).toEqual({ kind: 'LINKED', digestOptIn: true });
    expect(out.requestId).toBeUndefined();
    const renter = db.tables.renters.find(r => r.phone_e164 === PHONE)!;
    expect(renter.user_id).toBe('u1');
    expect(renter.digest_opt_in_at).toBeTruthy();

    // Answered like a watch code: agent on or off.
    const action = decideAction({ enabled: false, intent: out.intent, text: '', optedOut: false, confirmed: false, link: out.link });
    expect(action.kind).toBe('ACCOUNT_LINKED');
    expect(renderLinkOutcome(out.link!)).toContain('up to twice a week');
  });

  it('never moves a number linked to another account', async () => {
    db.tables.renters.push({ id: 'r1', phone_e164: PHONE, user_id: 'someone-else', opted_out_at: null, service_window_expires_at: null });
    // deno-lint-ignore no-explicit-any
    const code = await linkCodeFor(db as any, 'u1', NOW);
    const out = await inbound(`link my account (${code})`);
    expect(out.link).toEqual({ kind: 'PROBLEM', problem: 'OTHER_ACCOUNT' });
    expect(db.tables.renters[0].user_id).toBe('someone-else');
  });

  it('does not carry the opt-in onto a number that said STOP', async () => {
    db.tables.renters.push({ id: 'r1', phone_e164: PHONE, user_id: null, opted_out_at: '2026-10-01T00:00:00Z', service_window_expires_at: null });
    // deno-lint-ignore no-explicit-any
    await recordDigestOptIn(db as any, 'u1', NOW);
    // deno-lint-ignore no-explicit-any
    const code = await linkCodeFor(db as any, 'u1', NOW);
    const out = await inbound(`link my account (${code})`);
    expect(out.link).toEqual({ kind: 'LINKED', digestOptIn: false });
    expect(db.tables.renters[0].digest_opt_in_at ?? null).toBeNull();
  });

  it('says so when the code is unknown', async () => {
    const out = await inbound('link my account (HL-AAAA)');
    expect(out.link).toEqual({ kind: 'PROBLEM', problem: 'UNKNOWN' });
  });
});
