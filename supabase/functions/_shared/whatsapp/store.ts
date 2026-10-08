// MessageStore backed by Postgres.
//
// Deliberately thin: every rule lives in send.ts, and this only knows how to
// read and write rows. If a decision appears in here, it is in the wrong place.

import { DuplicateKeyError, isAcknowledgement, type MessageStore, type NewMessage, type StoredMessage, type StoredRenter } from './send.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export class SupabaseMessageStore implements MessageStore {
  constructor(private readonly db: Supa) {}

  async findByIdempotencyKey(key: string): Promise<StoredMessage | null> {
    const { data } = await this.db
      .from('messages').select('*').eq('idempotency_key', key).maybeSingle();
    return (data as StoredMessage) ?? null;
  }

  async insertQueued(row: NewMessage): Promise<StoredMessage> {
    const { data, error } = await this.db
      .from('messages')
      .insert({ ...row, status: 'QUEUED' })
      .select('*')
      .single();

    if (error) {
      // 23505 is the unique index on idempotency_key doing its job: two callers
      // raced and the other one won. Its row is the message - said as an error
      // so the loser knows not to send it (send.ts persistThenSend).
      if (error.code === '23505') throw new DuplicateKeyError(row.idempotency_key);
      throw error;
    }
    return data as StoredMessage;
  }

  async requeue(id: string): Promise<void> {
    await this.db.from('messages').update({ status: 'QUEUED', error: null }).eq('id', id).eq('status', 'FAILED');
  }

  async markSent(id: string, providerId?: string): Promise<void> {
    await this.db.from('messages')
      .update({ status: 'SENT', provider_id: providerId ?? null, sent_at: new Date().toISOString() })
      .eq('id', id);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.from('messages')
      .update({ status: 'FAILED', error: error.slice(0, 500) })
      .eq('id', id);
  }

  /**
   * Outbound messages since this renter's last inbound.
   *
   * Counted from the renter's phone rather than a request id, because the rule
   * is about how much we are saying to a person - across requests, not within
   * one.
   */
  async countConsecutiveOutbound(renterId: string): Promise<number> {
    const renter = await this.getRenter(renterId);
    if (!renter) return 0;

    const { data } = await this.db
      .from('messages')
      .select('direction, idempotency_key')
      .eq('to_phone', renter.phone_e164)
      .order('created_at', { ascending: false })
      .limit(20);

    let n = 0;
    for (const m of (data ?? []) as { direction: string; idempotency_key?: string | null }[]) {
      if (m.direction === 'IN') break;
      // A receipt answers the renter's message; it is not one of ours in a row.
      if (isAcknowledgement(m.idempotency_key)) continue;
      n++;
    }
    return n;
  }

  async getRenter(renterId: string): Promise<StoredRenter | null> {
    const { data } = await this.db
      .from('renters')
      .select('id, phone_e164, service_window_expires_at, opted_out_at')
      .eq('id', renterId)
      .maybeSingle();
    return (data as StoredRenter) ?? null;
  }

  async touchServiceWindow(renterId: string, expiresAt: string): Promise<void> {
    await this.db.from('renters')
      .update({ service_window_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq('id', renterId);
  }

  /**
   * Meta's last-known status, or null when the template has never been synced.
   *
   * Null on a query error too, deliberately: this check exists to catch an
   * approval Meta withdrew, and a database hiccup must not become a reason no
   * template can be sent at all.
   */
  async getTemplateStatus(name: string): Promise<{ status: string } | null> {
    const { data, error } = await this.db
      .from('whatsapp_template_status').select('status').eq('name', name).maybeSingle();
    if (error) {
      console.warn('[whatsapp] template status lookup failed, falling back to the code flag:', error);
      return null;
    }
    return data ? { status: String(data.status) } : null;
  }
}

/** Find a renter by phone, or create one. Used by the inbound path. */
export async function upsertRenterByPhone(db: Supa, phoneE164: string): Promise<StoredRenter> {
  const { data: existing } = await db
    .from('renters')
    .select('id, phone_e164, service_window_expires_at, opted_out_at')
    .eq('phone_e164', phoneE164)
    .maybeSingle();
  if (existing) return existing as StoredRenter;

  const { data, error } = await db
    .from('renters')
    .insert({ phone_e164: phoneE164 })
    .select('id, phone_e164, service_window_expires_at, opted_out_at')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: raced } = await db
        .from('renters')
        .select('id, phone_e164, service_window_expires_at, opted_out_at')
        .eq('phone_e164', phoneE164)
        .maybeSingle();
      if (raced) return raced as StoredRenter;
    }
    throw error;
  }
  return data as StoredRenter;
}
