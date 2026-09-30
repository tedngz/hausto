// How many agents the bridge may ask, and how often (PLAN-v3 S7.2).
//
// Availability checks are cold messages from the business's personal Zalo
// account to agents who, mostly, have never heard from us. Zalo restricts
// accounts that message many strangers, and losing the account loses every
// agent conversation at once - so the limits are set by that risk, not by how
// much sourcing we would like to do:
//
//   * a few agents new to us per Ho Chi Minh City day;
//   * one availability check per agent per request - chasing is a phone call;
//   * a few checks to any one agent per week, however many requests ask
//     about their building.
//
// Viewing-request messages are not counted here: those agents advertised the
// unit and expect to be asked about it. The device's own daily cap
// (bridge/src/bridge.ts) still bounds everything it sends.

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Agents we have never messaged, asked per Ho Chi Minh City day. */
export const MAX_NEW_AGENTS_PER_DAY = 5;
/** Availability checks to one agent in any 7 days, across requests. */
export const MAX_CHECKS_PER_AGENT_PER_WEEK = 3;

const WEEK_MS = 7 * 86_400_000;

export interface PriorMessage {
  realtorId: string | null;
  inquiryId: string | null;
  purpose: string;
  createdAt: string;
  status: string;
}

/** `YYYY-MM-DD` in Ho Chi Minh City. */
function hcmcDay(t: number): string {
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * May this agent be asked about this request now? Null when yes, else why not.
 *
 * `toAgent` is every outbound message we have sent this agent; failed sends
 * never reached them and do not count. `newAgentsToday` is how many agents
 * received their first message from us today.
 */
export function outreachRefusal(opts: {
  toAgent: PriorMessage[];
  inquiryId: string;
  newAgentsToday: number;
  now: Date;
}): string | null {
  const live = opts.toAgent.filter(m => m.status !== 'FAILED');
  if (live.some(m => m.inquiryId === opts.inquiryId && m.purpose === 'AVAILABILITY_CHECK')) {
    return 'This agent has already been asked about this request. Chase by phone if they have gone quiet.';
  }
  const weekAgo = opts.now.getTime() - WEEK_MS;
  const checks = live.filter(m => m.purpose === 'AVAILABILITY_CHECK' && Date.parse(m.createdAt) > weekAgo);
  if (checks.length >= MAX_CHECKS_PER_AGENT_PER_WEEK) {
    return `This agent has had ${checks.length} availability checks from us this week. Ask them by phone, or wait.`;
  }
  if (live.length === 0 && opts.newAgentsToday >= MAX_NEW_AGENTS_PER_DAY) {
    return `${MAX_NEW_AGENTS_PER_DAY} agents new to us have been messaged today - the most the Zalo account should reach out to cold. Ask this one tomorrow, or by phone.`;
  }
  return null;
}

/** The facts outreachRefusal needs, read from realtor_messages. */
export async function loadOutreach(db: Supa, realtorId: string, now: Date): Promise<{
  toAgent: PriorMessage[];
  newAgentsToday: number;
}> {
  const rows = async (q: Supa) => ((await q).data ?? []) as {
    realtor_id: string | null; inquiry_id: string | null; purpose: string; created_at: string; status: string;
  }[];
  const toAgent = (await rows(db.from('realtor_messages')
    .select('realtor_id, inquiry_id, purpose, created_at, status')
    .eq('realtor_id', realtorId).eq('direction', 'OUT'))).map(m => ({
    realtorId: m.realtor_id, inquiryId: m.inquiry_id, purpose: m.purpose, createdAt: m.created_at, status: m.status,
  }));

  // Agents whose first message from us went out today: everyone messaged in
  // the last day, less anyone messaged before today.
  const today = hcmcDay(now.getTime());
  const recent = await rows(db.from('realtor_messages')
    .select('realtor_id, inquiry_id, purpose, created_at, status')
    .eq('direction', 'OUT').gte('created_at', new Date(now.getTime() - 86_400_000).toISOString()));
  const todays = new Set(recent
    .filter(m => m.realtor_id && m.status !== 'FAILED' && hcmcDay(Date.parse(m.created_at)) === today)
    .map(m => m.realtor_id as string));
  let newAgentsToday = 0;
  for (const id of todays) {
    const earlier = await rows(db.from('realtor_messages')
      .select('realtor_id, inquiry_id, purpose, created_at, status')
      .eq('realtor_id', id).eq('direction', 'OUT'));
    if (!earlier.some(m => m.status !== 'FAILED' && hcmcDay(Date.parse(m.created_at)) < today)) newAgentsToday++;
  }
  return { toAgent, newAgentsToday };
}
