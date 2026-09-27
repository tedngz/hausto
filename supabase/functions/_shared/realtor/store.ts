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
