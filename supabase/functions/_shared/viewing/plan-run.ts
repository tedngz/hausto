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
import { planRequest, AGENT_VERSION, type PlanItem, type UnreadReply } from './planner.ts';
import type { ParseContext, ParseSuggestion } from './parse-reply.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Model reads per pass. A backlog is read over several passes, not in one expensive burst. */
export const MAX_PARSES_PER_RUN = 10;

export interface RunResult {
  scanned: number;
  proposed: number;
  superseded: number;
  parsed: number;
}

export async function runPlanner(
  db: Supa,
  opts: {
    requestIds?: string[];
    now: Date;
    /** Null when the model cannot be asked - the planner escalates instead. */
    parse: (ctx: ParseContext) => Promise<ParseSuggestion | null>;
  },
): Promise<RunResult> {
  const result: RunResult = { scanned: 0, proposed: 0, superseded: 0, parsed: 0 };

  let query = db.from('viewing_requests').select('id, availability, created_at');
  if (opts.requestIds?.length) {
    query = query.in('id', opts.requestIds);
  } else {
    // The drain's horizon: a request untouched for three weeks is not one a
    // proposal helps.
    query = query.gte('created_at', new Date(opts.now.getTime() - 21 * 86_400_000).toISOString());
  }
  const { data: requests } = await query.order('created_at', { ascending: true }).limit(500);

  for (const req of (requests ?? []) as { id: string; availability: unknown }[]) {
    result.scanned += 1;
    const availability = Array.isArray(req.availability) ? req.availability as { date: string; part: string }[] : [];

    const [{ data: evs }, { data: rows }, { data: replies }, { data: existing }] = await Promise.all([
      db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
        .eq('request_id', req.id).order('occurred_at', { ascending: true }),
      db.from('ops_request_items_view')
        .select('id, listing_title, listing_url, district_code, price_vnd_at_request, realtor_phone')
        .eq('request_id', req.id),
      db.from('realtor_messages').select('id, item_id, body, created_at')
        .eq('request_id', req.id).eq('direction', 'IN').order('created_at', { ascending: true }),
      db.from('operator_proposals').select('id, dedupe_key, status').eq('request_id', req.id),
    ]);

    const events = (evs ?? []) as DomainEvent[];
    const view = reduceRequest(req.id, events);
    const items: PlanItem[] = ((rows ?? []) as Record<string, unknown>[]).map(r => ({
      itemId: String(r.id),
      listingTitle: String(r.listing_title ?? 'the unit'),
      listingUrl: (r.listing_url as string) ?? null,
      districtCode: (r.district_code as string) ?? null,
      priceVnd: Number(r.price_vnd_at_request ?? 0),
      hasContact: !!r.realtor_phone,
    }));
    const keys = new Set(((existing ?? []) as { dedupe_key: string }[]).map(p => p.dedupe_key));

    // Unread: a broker's reply stored after the item's last outcome. A reply
    // pasted together with the outcome it produced is older than that outcome
    // and is not unread - it has been read, by the person who recorded it.
    const lastOutcome = new Map<string, string>();
    for (const e of events) if (e.type === 'OUTCOME_RECORDED' && e.item_id) lastOutcome.set(e.item_id, e.occurred_at);

    const unreadReplies: UnreadReply[] = [];
    for (const r of (replies ?? []) as { id: string; item_id: string | null; body: string; created_at: string }[]) {
      if (!r.item_id) continue;
      const after = lastOutcome.get(r.item_id);
      if (after && r.created_at <= after) continue;
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

    const proposals = planRequest({
      requestId: req.id, view, events, items, availability, unreadReplies, now: opts.now.getTime(),
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
      })));
      if (error) console.error('[plan-run] insert failed:', error);
      else result.proposed += fresh.length;
    }

    const live = new Set(proposals.map(p => p.key));
    for (const p of (existing ?? []) as { id: string; dedupe_key: string; status: string }[]) {
      if (p.status !== 'PENDING' || live.has(p.dedupe_key)) continue;
      await db.from('operator_proposals').update({ status: 'SUPERSEDED', decided_at: opts.now.toISOString() }).eq('id', p.id);
      result.superseded += 1;
    }
  }

  return result;
}
