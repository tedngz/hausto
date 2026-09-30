// Sending an alert, and answering the reply to one (SPEC §11).
//
// An alert is the one message a week that tells a renter about places they did
// not ask about by id - from a complex watch, the digest, or both. Split from
// the sweep so the rehearsal can drive the same code the cron does.
//
// `alert_items` is the record of what was put in front of whom. It does two
// jobs: nothing is alerted twice, and a reply to a template knows which places
// it is asking about.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import { isWindowOpen, sendFreeForm, sendTemplate, type MessageStore } from '../whatsapp/send.ts';
import { TEMPLATES } from '../whatsapp/templates.ts';
import { digestPurpose } from './digest.ts';
import { itineraryAwaitingAnswer } from './open-request.ts';
import {
  ALERT_REPLY_DAYS,
  alertIntro,
  alertParams,
  renderAlertDetails,
  type AlertCandidate,
} from './watch.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface AlertSendResult {
  sent: boolean;
  deduplicated: boolean;
  messageId?: string;
  /** True when the places went in the message itself, not a template. */
  detailed: boolean;
  /** Not sent this week: an itinerary is waiting for the renter's yes. */
  held?: boolean;
}

/**
 * Send one renter this week's alert.
 *
 * Keyed on the ISO week - the digest's key - so however many watches a renter
 * has, and whether or not the digest also found something, they get one
 * message. Free-form with the places in it when their window happens to be
 * open; the template otherwise, and the places follow their reply.
 */
export async function sendAlert(
  db: Supa,
  store: MessageStore,
  adapter: WhatsAppAdapter,
  opts: { renterId: string; renterName: string | null; items: AlertCandidate[]; now: Date },
): Promise<AlertSendResult> {
  if (opts.items.length === 0) return { sent: false, deduplicated: false, detailed: false };
  // A renter who owes us a yes on their itinerary does not also get "reply
  // here if you would like to see them": their next "yes" is the plan's
  // (routing.ts), and this can wait a week.
  if (await itineraryAwaitingAnswer(db, opts.renterId)) {
    return { sent: false, deduplicated: false, detailed: false, held: true };
  }

  const renter = await store.getRenter(opts.renterId);
  if (!renter) throw new Error(`Unknown renter ${opts.renterId}`);
  const detailed = isWindowOpen(renter, opts.now);

  const purpose = digestPurpose(opts.now);
  const result = detailed
    ? await sendFreeForm(store, adapter, {
      renterId: opts.renterId,
      purpose,
      body: renderAlertDetails(opts.items, { intro: alertIntro(opts.items) }),
      now: opts.now,
    })
    : await sendTemplate(store, adapter, {
      renterId: opts.renterId,
      purpose,
      templateName: TEMPLATES.WEEKLY_DIGEST.name,
      params: alertParams(opts.renterName, opts.items),
    });

  if (result.deduplicated) return { sent: false, deduplicated: true, messageId: result.message.id, detailed };
  // A failed send is not an alert. Leaving the items unrecorded means next
  // week can offer them again, which is the right way round.
  if (result.message.status !== 'SENT') return { sent: false, deduplicated: false, messageId: result.message.id, detailed };

  const { error } = await db.from('alert_items').insert(opts.items.map(it => ({
    renter_id: opts.renterId,
    listing_id: it.listingId,
    watch_id: it.watchId,
    source: it.source,
    message_id: result.message.id,
    detail_sent_at: detailed ? opts.now.toISOString() : null,
  })));
  // The message is out. Losing the record costs a repeat next week, not a
  // failed send, so it is logged rather than thrown.
  if (error) console.error(`[alerts] recording items for ${opts.renterId} failed:`, error.message ?? error);

  return { sent: true, deduplicated: false, messageId: result.message.id, detailed };
}

/**
 * Is this inbound a reply to an alert whose places we have not sent yet?
 *
 * `answered` is the message the reply is about (routing.ts `answeredMessage`):
 * the one they swiped to reply to, or else the last thing we sent them. A bare
 * "yes" is about whatever we last asked, so if an itinerary went out after the
 * alert, "yes" is about the itinerary. Returns the alert's message id.
 */
export async function pendingAlert(
  db: Supa,
  answered: { id: string; createdAt: string },
  now: Date,
): Promise<string | undefined> {
  if (now.getTime() - Date.parse(answered.createdAt) > ALERT_REPLY_DAYS * 86_400_000) return undefined;
  const { data: items } = await db
    .from('alert_items')
    .select('id')
    .eq('message_id', answered.id)
    .is('detail_sent_at', null)
    .limit(1);
  return (items ?? []).length > 0 ? answered.id : undefined;
}

/**
 * The places an alert was about, as they stand now.
 *
 * Re-read rather than remembered: a week is long enough for a listing to go,
 * and a link to a place that is no longer live is worse than leaving it out.
 */
export async function alertItemsFor(db: Supa, messageId: string): Promise<AlertCandidate[]> {
  const { data: rows } = await db
    .from('alert_items')
    .select('listing_id, watch_id, source')
    .eq('message_id', messageId);
  const items = (rows ?? []) as { listing_id: string; watch_id: string | null; source: AlertCandidate['source'] }[];
  if (items.length === 0) return [];

  const { data: listings } = await db
    .from('external_properties')
    .select('id, title, price_vnd, bedrooms, district_code, is_active')
    .in('id', items.map(i => i.listing_id));
  const byId = new Map(((listings ?? []) as Record<string, unknown>[]).map(l => [String(l.id), l]));

  // The complex name for each watch, so a line says where it is.
  const watchIds = [...new Set(items.map(i => i.watch_id).filter((w): w is string => !!w))];
  const nameByWatch = new Map<string, string>();
  if (watchIds.length > 0) {
    const { data: watches } = await db.from('complex_watches').select('id, complex_id').in('id', watchIds);
    const complexIds = [...new Set(((watches ?? []) as { complex_id: string }[]).map(w => w.complex_id))];
    const { data: complexes } = complexIds.length
      ? await db.from('complexes').select('id, name').in('id', complexIds)
      : { data: [] };
    const nameByComplex = new Map(((complexes ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]));
    for (const w of (watches ?? []) as { id: string; complex_id: string }[]) {
      const name = nameByComplex.get(w.complex_id);
      if (name) nameByWatch.set(w.id, name);
    }
  }

  const out: AlertCandidate[] = [];
  for (const i of items) {
    const l = byId.get(i.listing_id);
    if (!l || l.is_active !== true) continue;
    out.push({
      listingId: i.listing_id,
      title: (l.title as string) ?? null,
      priceVnd: (l.price_vnd as number) ?? null,
      bedrooms: (l.bedrooms as number) ?? null,
      source: i.source,
      watchId: i.watch_id,
      // The same label the sweep gave it: the complex for a watch, the
      // district for a digest pick.
      label: (i.watch_id && nameByWatch.get(i.watch_id)) || (l.district_code as string) || null,
    });
  }
  return out;
}

/** Mark an alert's places as sent, so a second reply does not resend them. */
export async function markAlertDetailed(db: Supa, messageId: string, now: Date): Promise<void> {
  await db.from('alert_items')
    .update({ detail_sent_at: now.toISOString() })
    .eq('message_id', messageId)
    .is('detail_sent_at', null);
}
