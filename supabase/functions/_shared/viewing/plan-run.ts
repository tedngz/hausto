// Running the AI operator's planner over live requests (stage 1, shadow).
//
// Reads each open request, reads any agent reply nobody has settled, asks the
// planner what should happen, and writes what is new as proposals. A pending
// proposal the planner no longer makes - because the request moved on without
// it - is marked SUPERSEDED, so the console never offers a stale action and
// the agreement rate never counts one.
//
// Shared rather than inside the edge function so it runs against the
// in-memory database in tests, with the model call passed in.

import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import { planRequest, AGENT_VERSION, type PlanItem, type UnreadReply, type RenterDraft } from './planner.ts';
import type { BusySlot } from './itinerary.ts';
import { agentUnit } from '../realtor/unit.ts';
import type { ParseContext, ParseSuggestion } from './parse-reply.ts';
import { describeStatus, type DraftContext, type DraftResult, type ListingFacts, type ThreadLine } from './renter-reply.ts';
import { waitingReplies } from './thread.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { isWindowOpen, MAX_CONSECUTIVE_OUTBOUND } from '../whatsapp/send.ts';
import {
  autoEligible,
  autonomyState,
  mayExecute,
  AUTO_HOLD_MS,
  AUTO_AGENT_VERSION,
  AUTONOMOUS_ACTIONS,
  type AutonomyState,
} from './autonomy.ts';
import { agreementStats, type AgreementRow, type AgreementStats } from './proposals.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Model reads per pass. A backlog is read over several passes, not in one expensive burst. */
export const MAX_PARSES_PER_RUN = 10;
/** Drafted renter replies per pass, for the same reason. */
export const MAX_DRAFTS_PER_RUN = 10;

export interface RunResult {
  scanned: number;
  proposed: number;
  superseded: number;
  parsed: number;
  drafted: number;
  /** Run by the AI operator itself (stage 2). */
  executed: number;
}

export async function runPlanner(
  db: Supa,
  opts: {
    requestIds?: string[];
    now: Date;
    /** Null when the model cannot be asked - the planner escalates instead. */
    parse: (ctx: ParseContext) => Promise<ParseSuggestion | null>;
    /** Draft an answer to the renter. Omitted, renter replies are escalated as before. */
    draft?: (ctx: DraftContext) => Promise<DraftResult | null>;
    /** Stage 2. Omitted, nothing runs by itself - shadow mode exactly. */
    autonomy?: { state: AutonomyState; deps: OpsDeps };
  },
): Promise<RunResult> {
  const result: RunResult = { scanned: 0, proposed: 0, superseded: 0, parsed: 0, drafted: 0, executed: 0 };
  const store = new SupabaseMessageStore(db);

  let query = db.from('viewing_requests').select('id, ref, renter_id, availability, move_in_date, created_at');
  if (opts.requestIds?.length) {
    query = query.in('id', opts.requestIds);
  } else {
    // The drain's horizon: a request untouched for three weeks is not one a
    // proposal helps.
    query = query.gte('created_at', new Date(opts.now.getTime() - 21 * 86_400_000).toISOString());
  }
  const { data: requests } = await query.order('created_at', { ascending: true }).limit(500);

  for (const req of (requests ?? []) as { id: string; ref: string; renter_id: string; availability: unknown; move_in_date: string | null }[]) {
    result.scanned += 1;
    const availability = Array.isArray(req.availability) ? req.availability as { date: string; part: string }[] : [];

    const [{ data: evs }, { data: rows }, { data: replies }, { data: existing }] = await Promise.all([
      db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
        .eq('request_id', req.id).order('occurred_at', { ascending: true }),
      db.from('ops_request_items_view')
        .select('id, listing_id, listing_title, listing_url, listing_location, district_code, bedrooms, price_vnd_at_request, realtor_phone')
        .eq('request_id', req.id),
      db.from('realtor_messages').select('id, item_id, body, created_at')
        .eq('request_id', req.id).eq('direction', 'IN').order('created_at', { ascending: true }),
      db.from('operator_proposals')
        .select('id, dedupe_key, status, action, input, confidence, execute_after').eq('request_id', req.id),
    ]);

    const events = (evs ?? []) as DomainEvent[];
    const view = reduceRequest(req.id, events);
    const items: PlanItem[] = ((rows ?? []) as Record<string, unknown>[]).map(r => ({
      itemId: String(r.id),
      listingTitle: String(r.listing_title ?? 'the unit'),
      unit: agentUnit({
        title: (r.listing_title as string) ?? null,
        location: (r.listing_location as string) ?? null,
        districtCode: (r.district_code as string) ?? null,
        bedrooms: r.bedrooms == null ? null : Number(r.bedrooms),
        url: (r.listing_url as string) ?? null,
      }),
      districtCode: (r.district_code as string) ?? null,
      priceVnd: Number(r.price_vnd_at_request ?? 0),
      hasContact: !!r.realtor_phone,
    }));
    const keys = new Set(((existing ?? []) as { dedupe_key: string }[]).map(p => p.dedupe_key));

    // Unread: a broker's reply stored after the item's last outcome. A reply
    // pasted together with the outcome it produced is older than that outcome
    // and is not unread - it has been read, by the person who recorded it.
    // So is one we have since written back to the agent about: asked for
    // another time because theirs clashed, they are waiting on us no longer.
    const lastOutcome = new Map<string, string>();
    const lastWrote = new Map<string, string>();
    for (const e of events) {
      if (e.type === 'OUTCOME_RECORDED' && e.item_id) lastOutcome.set(e.item_id, e.occurred_at);
      if (e.type === 'REALTOR_CONTACTED' && e.item_id) lastWrote.set(e.item_id, e.occurred_at);
    }

    const unreadReplies: UnreadReply[] = [];
    for (const r of (replies ?? []) as { id: string; item_id: string | null; body: string; created_at: string }[]) {
      if (!r.item_id) continue;
      const after = lastOutcome.get(r.item_id);
      if (after && r.created_at <= after) continue;
      // Strictly after: a reply is an answer to our message, never the reverse.
      const wrote = lastWrote.get(r.item_id);
      if (wrote && r.created_at < wrote) continue;
      const item = items.find(i => i.itemId === r.item_id);
      if (!item) continue;
      let suggestion: ParseSuggestion | null = null;
      // Read once. A proposal already made for this reply keeps its key alive
      // without paying for a second reading.
      if (!keys.has(`OUTCOME:${r.item_id}:${r.id}`) && result.parsed < MAX_PARSES_PER_RUN) {
        result.parsed += 1;
        suggestion = await opts.parse({
          reply: r.body, listingTitle: item.listingTitle, priceVnd: item.priceVnd, availability, now: opts.now,
        });
      }
      unreadReplies.push({ itemId: r.item_id, messageId: r.id, suggestion });
    }

    // A drafted answer to the renter's newest waiting reply - once per reply,
    // and only when there is something legal to send it on.
    let renterDraft: RenterDraft | undefined;
    const waiting = waitingReplies(events);
    const newest = waiting[waiting.length - 1];
    if (
      opts.draft && newest?.messageId && !waiting.some(w => w.intent === 'DECLINE')
      && !keys.has(`RENTER:${newest.messageId}`) && result.drafted < MAX_DRAFTS_PER_RUN
    ) {
      const blocked = await whyCannotMessage(store, req.renter_id, opts.now);
      let draft: DraftResult | null = null;
      if (!blocked) {
        result.drafted += 1;
        draft = await opts.draft(await draftContext(db, req, view, (rows ?? []) as Record<string, unknown>[], opts.now));
      }
      renterDraft = { messageId: newest.messageId, draft, ...(blocked ? { blocked } : {}) };
    }

    // Times proposed on an earlier run and not recorded yet: the next agent's
    // answer is checked against them too, so two replies a run apart cannot
    // both take the same morning.
    const proposedSlots: BusySlot[] = [];
    for (const p of (existing ?? []) as ExistingProposal[]) {
      const slot = (p.input?.slots as { startsAt?: string; durationMinutes?: number }[] | undefined)?.[0];
      if (p.status !== 'PENDING' || p.action !== 'OUTCOME' || p.input?.outcome !== 'CONFIRMED' || !slot?.startsAt) continue;
      const itemId = String(p.input.itemId ?? '');
      proposedSlots.push({
        itemId, listingTitle: items.find(i => i.itemId === itemId)?.listingTitle ?? 'another place',
        startsAt: slot.startsAt, durationMinutes: Number(slot.durationMinutes) || 30,
      });
    }

    const proposals = planRequest({
      requestId: req.id, view, events, items, availability, moveInDate: req.move_in_date ?? null,
      unreadReplies, renterDraft, proposedSlots,
      now: opts.now.getTime(),
    });

    const fresh = proposals.filter(p => !keys.has(p.key));
    if (fresh.length > 0) {
      const { error } = await db.from('operator_proposals').insert(fresh.map(p => ({
        request_id: p.requestId,
        item_id: p.itemId,
        dedupe_key: p.key,
        action: p.action,
        input: p.input,
        rationale: p.rationale,
        confidence: p.confidence,
        agent_version: AGENT_VERSION,
        status: 'PENDING',
        // Stage 2: one the AI operator may run itself, after a hold in which
        // a person can still take it. Decided at creation, against the locks
        // as they are now - a proposal made while the gate was shut stays a
        // person's.
        execute_after: opts.autonomy && autoEligible(p) && opts.autonomy.state.actions[p.action].open
          ? new Date(opts.now.getTime() + AUTO_HOLD_MS).toISOString()
          : null,
      })));
      if (error) console.error('[plan-run] insert failed:', error);
      else result.proposed += fresh.length;
    }

    const live = new Set(proposals.map(p => p.key));
    for (const p of (existing ?? []) as ExistingProposal[]) {
      if (p.status !== 'PENDING') continue;
      if (!live.has(p.dedupe_key)) {
        await db.from('operator_proposals').update({ status: 'SUPERSEDED', decided_at: opts.now.toISOString() }).eq('id', p.id);
        result.superseded += 1;
        continue;
      }
      // Due, still wanted, and every lock still open - checked again now, not
      // trusted from when the hold was set.
      if (opts.autonomy && mayExecute(opts.autonomy.state, p, opts.now.getTime())) {
        if (await executeAutonomously(db, opts.autonomy.deps, p, opts.now)) result.executed += 1;
      }
    }
  }

  return result;
}

interface ExistingProposal {
  id: string;
  dedupe_key: string;
  status: string;
  action: string;
  input: Record<string, unknown>;
  confidence: string;
  execute_after: string | null;
}

/**
 * Run a proposal as the AI operator itself. Through the same performOpsAction
 * as every person's action, so every rule - the 24-hour window, no third
 * message in a row, persist before send - applies unchanged.
 *
 * A failure hands it to a person rather than retrying: the reasons it fails
 * (the window shut, a message already sent) are ones a retry cannot fix.
 */
async function executeAutonomously(db: Supa, deps: OpsDeps, p: ExistingProposal, now: Date): Promise<boolean> {
  const r = await performOpsAction(db, deps, `AGENT:${AUTO_AGENT_VERSION}`, { ...p.input, action: p.action, viaProposal: p.id });
  if (r.status === 200) {
    await db.from('operator_proposals').update({
      status: 'EXECUTED', executed_at: now.toISOString(), executed_action: p.action, executed_input: p.input,
    }).eq('id', p.id);
    return true;
  }
  await db.from('operator_proposals').update({
    execute_after: null,
    decision_note: `Did not run itself: ${String(r.body.message ?? r.body.error ?? r.status)}. Handed to a person.`,
  }).eq('id', p.id);
  return false;
}

/**
 * Why a free-form message cannot go to this renter right now, or null. The
 * send layer enforces all three on approval anyway; checking first means no
 * draft is paid for that could never be sent.
 */
async function whyCannotMessage(store: SupabaseMessageStore, renterId: string, now: Date): Promise<string | null> {
  const renter = await store.getRenter(renterId);
  if (!renter) return 'the renter record is missing.';
  if (renter.opted_out_at) return 'the renter opted out.';
  if (!isWindowOpen(renter, now)) return 'the 24-hour window is closed, so nothing free-form can be sent until they write again.';
  if (await store.countConsecutiveOutbound(renterId) >= MAX_CONSECUTIVE_OUTBOUND) {
    return 'two messages have already gone since they last wrote.';
  }
  return null;
}

/**
 * What the draft is written from: listing facts, each unit's standing, and
 * the renter's own thread. Selected column by column - no contact column of
 * the listing is read, and no renter or agent contact is passed on, so the
 * model has nothing of the kind to repeat (invariant 4).
 */
async function draftContext(
  db: Supa,
  req: { id: string; ref: string },
  view: ReturnType<typeof reduceRequest>,
  rows: Record<string, unknown>[],
  now: Date,
): Promise<DraftContext> {
  const listingIds = rows.map(r => String(r.listing_id));
  const [{ data: facts }, { data: msgs }] = await Promise.all([
    db.from('external_properties')
      .select('id, title, location, district_code, bedrooms, area_sqm, price_vnd, amenities, description')
      .in('id', listingIds),
    db.from('messages').select('direction, body, template_name, created_at')
      .eq('request_id', req.id).order('created_at', { ascending: true }),
  ]);
  const byId = new Map(((facts ?? []) as Record<string, unknown>[]).map(f => [String(f.id), f]));

  const listings: ListingFacts[] = rows.map(r => {
    const f = byId.get(String(r.listing_id)) ?? {};
    const item = view.items[String(r.id)];
    return {
      itemId: String(r.id),
      title: String(f.title ?? r.listing_title ?? 'A place'),
      districtCode: (f.district_code as string) ?? null,
      location: (f.location as string) ?? null,
      priceVnd: Number(r.price_vnd_at_request ?? f.price_vnd ?? 0),
      bedrooms: f.bedrooms != null ? Number(f.bedrooms) : null,
      areaSqm: f.area_sqm != null ? Number(f.area_sqm) : null,
      amenities: Array.isArray(f.amenities) ? (f.amenities as unknown[]).map(String) : [],
      description: (f.description as string) ?? null,
      status: describeStatus(item?.state ?? 'PENDING', item?.slots ?? [], item?.actualPriceVnd),
    };
  });

  const thread: ThreadLine[] = ((msgs ?? []) as Record<string, unknown>[])
    .filter(m => typeof m.body === 'string' && m.body)
    .map(m => ({ direction: m.direction === 'IN' ? 'IN' : 'OUT', body: String(m.body), at: String(m.created_at) }));

  return { ref: req.ref, state: view.state, listings, thread, now };
}

/** How many of the most recent human decisions the gate is measured over. */
export const GATE_SAMPLE = 100;

/**
 * The three locks, read fresh on every pass (autonomy.ts), and written back to
 * `ai_operator_controls.last_state` for the console to show.
 *
 * The shadow record is the most recent human decisions on each action however
 * old, not a date window: once an action runs itself, people decide fewer of
 * them, and a 30-day window would close a healthy gate for lack of decisions.
 * What keeps it honest once acting is the flag rate, over the last 30 days.
 */
export async function loadAutonomyState(
  db: Supa,
  env: string | undefined,
  now: Date,
  /** Facts the console cannot read for itself, stored beside the state (e.g. which realtor channel is live). */
  extra: Record<string, unknown> = {},
): Promise<AutonomyState> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [{ data: controls }, ...perAction] = await Promise.all([
    db.from('ai_operator_controls').select('paused, gate_override').eq('id', 'singleton').maybeSingle(),
    ...AUTONOMOUS_ACTIONS.map(action => Promise.all([
      db.from('operator_proposals').select('action, status, edited')
        .eq('action', action).in('status', ['APPROVED', 'AGREED', 'CORRECTED', 'REJECTED'])
        .order('decided_at', { ascending: false }).limit(GATE_SAMPLE),
      db.from('operator_proposals').select('status')
        .eq('action', action).in('status', ['EXECUTED', 'FLAGGED']).gte('executed_at', since),
    ])),
  ]);

  const stats: AgreementStats[] = [];
  const executed: Record<string, number> = {};
  const flagged: Record<string, number> = {};
  AUTONOMOUS_ACTIONS.forEach((action, i) => {
    const [{ data: decided }, { data: acted }] = perAction[i] as [{ data: unknown[] }, { data: { status: string }[] }];
    stats.push(...agreementStats((decided ?? []) as AgreementRow[]));
    executed[action] = (acted ?? []).filter(r => r.status === 'EXECUTED').length;
    flagged[action] = (acted ?? []).filter(r => r.status === 'FLAGGED').length;
  });

  const state = autonomyState({
    env, paused: controls?.paused === true, stats, executed, flagged,
    gateOverride: Array.isArray(controls?.gate_override) ? controls.gate_override : [],
    realtorChannel: typeof extra.realtorChannel === 'string' ? extra.realtorChannel : 'manual',
  });
  await db.from('ai_operator_controls')
    .update({ last_state: { ...state, ...extra }, last_run_at: now.toISOString() }).eq('id', 'singleton');
  return state;
}
