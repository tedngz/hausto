// RealtorMessageStore backed by Postgres. Thin on purpose: the rules live in
// send.ts, and this only reads and writes rows.

import type { RealtorMessageStore, NewRealtorMessage, StoredRealtorMessage } from './send.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export class SupabaseRealtorMessageStore implements RealtorMessageStore {
  constructor(private readonly db: Supa) {}

  async findByIdempotencyKey(key: string): Promise<StoredRealtorMessage | null> {
    const { data } = await this.db
      .from('realtor_messages').select('*').eq('idempotency_key', key).maybeSingle();
    return (data as StoredRealtorMessage) ?? null;
  }

  async insert(row: NewRealtorMessage & { status: StoredRealtorMessage['status'] }): Promise<StoredRealtorMessage> {
    const { data, error } = await this.db.from('realtor_messages').insert(row).select('*').single();
    if (error) {
      // Two callers raced on one key and the other won - its row is the message.
      if (error.code === '23505') {
        const existing = await this.findByIdempotencyKey(row.idempotency_key);
        if (existing) return existing;
      }
      throw error;
    }
    return data as StoredRealtorMessage;
  }

  async markSent(id: string, providerId?: string): Promise<void> {
    await this.db.from('realtor_messages')
      .update({ status: 'SENT', provider_id: providerId ?? null, sent_at: new Date().toISOString() })
      .eq('id', id);
  }

  async requeue(id: string, body: string): Promise<StoredRealtorMessage> {
    await this.db.from('realtor_messages')
      .update({ status: 'QUEUED', body, error: null, claimed_at: null })
      .eq('id', id);
    const { data } = await this.db.from('realtor_messages').select('*').eq('id', id).maybeSingle();
    return data as StoredRealtorMessage;
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.from('realtor_messages')
      .update({ status: 'FAILED', error: error.slice(0, 500) })
      .eq('id', id);
  }
}

/**
 * The agent with this number, created if new. A name or agency fills a blank,
 * never overwrites one - the first operator to learn it is as likely right as
 * the second. Shared by RECORD_CONTACT, ADD_BUILDING_AGENT, and an agent found
 * in a group for a search (inquiry-actions.ts).
 */
export async function upsertRealtor(
  db: Supa,
  phone: string,
  name: string | null,
  agency: string | null = null,
): Promise<{ id: string } | null> {
  let { data: realtor } = await db
    .from('realtors').select('id, display_name, agency').eq('phone_e164', phone).maybeSingle();
  if (!realtor) {
    const { data, error } = await db
      .from('realtors').insert({ phone_e164: phone, display_name: name, agency })
      .select('id, display_name, agency').single();
    if (error?.code === '23505') {
      ({ data: realtor } = await db.from('realtors').select('id, display_name, agency').eq('phone_e164', phone).maybeSingle());
    } else if (error) {
      console.error('[realtor-store] realtor insert failed:', error);
      return null;
    } else {
      realtor = data;
    }
  } else {
    const patch: Record<string, unknown> = {};
    if (!realtor.display_name && name) patch.display_name = name;
    if (!realtor.agency && agency) patch.agency = agency;
    if (Object.keys(patch).length) {
      await db.from('realtors').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', realtor.id);
    }
  }
  return realtor ? { id: String(realtor.id) } : null;
}
