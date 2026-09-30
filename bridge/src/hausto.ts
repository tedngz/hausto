// The device's side of the zalo-bridge edge function.

export interface OutboxMessage { messageId: string; phone: string; body: string }
export interface PullResponse { paused: boolean; outbox: OutboxMessage[]; watch: string[] }
export interface Ack { messageId: string; sent: boolean; providerId?: string; error?: string }
export interface Inbound { fromPhone: string; text: string; providerMessageId: string; photos?: string[] }

export interface HaustoApi {
  pull(heartbeat: { device: string; version: string; sentToday: number; error: string | null }): Promise<PullResponse>;
  ack(acks: Ack[]): Promise<void>;
  inbound(messages: Inbound[]): Promise<void>;
}

export class HttpHaustoApi implements HaustoApi {
  constructor(private readonly url: string, private readonly token: string) {}

  private async call<T>(body: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': this.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`zalo-bridge ${res.status}: ${JSON.stringify(data)}`);
    return data as T;
  }

  pull(heartbeat: { device: string; version: string; sentToday: number; error: string | null }) {
    return this.call<PullResponse>({ action: 'pull', ...heartbeat });
  }

  async ack(acks: Ack[]) {
    if (acks.length) await this.call({ action: 'ack', acks });
  }

  async inbound(messages: Inbound[]) {
    if (messages.length) await this.call({ action: 'inbound', messages });
  }
}
