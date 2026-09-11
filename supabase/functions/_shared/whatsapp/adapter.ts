// The transport, and only the transport.
//
// Everything that makes sending *correct* - persist before send, idempotency,
// the service window, the consolidation guard - lives in send.ts. An adapter
// receives an already-persisted message and tries to deliver it. Keeping the
// split means the invariants are enforced once rather than once per transport,
// and that swapping Mock for Cloud cannot quietly change them.

export interface DeliveryRequest {
  toPhone: string;
  body?: string;
  templateName?: string;
  templateParams?: string[];
  /** The `messages` row id. Passed through for correlation in logs. */
  messageId: string;
}

export interface DeliveryResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

export interface WhatsAppAdapter {
  readonly mode: 'mock' | 'cloud';
  deliver(req: DeliveryRequest): Promise<DeliveryResult>;
}

/**
 * The default, in dev and in every test.
 *
 * It does not write to `messages` - send.ts already did that before calling
 * here, which is the whole point of persist-then-send. `/dev/phone` reads that
 * table, so a mock send and a real one produce an identical thread.
 */
export class MockAdapter implements WhatsAppAdapter {
  readonly mode = 'mock' as const;
  /** Exposed so tests and /dev/phone can assert what was attempted. */
  readonly delivered: DeliveryRequest[] = [];
  private failNext = false;

  /** Force the next delivery to fail, to exercise the FAILED path. */
  failNextDelivery(): void {
    this.failNext = true;
  }

  deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.resolve({ ok: false, error: 'mock: forced failure' });
    }
    this.delivered.push(req);
    return Promise.resolve({ ok: true, providerId: `mock-${req.messageId}` });
  }
}

/**
 * Meta Graph API. Enabled by WHATSAPP_MODE=cloud.
 *
 * Untestable end to end until Business verification and a provisioned number
 * exist, both human-blocked. It is written now so the shape is fixed and the
 * mock cannot drift from it, but nothing selects it by default.
 */
export class CloudApiAdapter implements WhatsAppAdapter {
  readonly mode = 'cloud' as const;

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly graphVersion = 'v21.0',
  ) {}

  async deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    const url = `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`;
    const payload = req.templateName
      ? {
          messaging_product: 'whatsapp',
          to: req.toPhone,
          type: 'template',
          template: {
            name: req.templateName,
            language: { code: 'en' },
            components: req.templateParams?.length
              ? [{ type: 'body', parameters: req.templateParams.map(text => ({ type: 'text', text })) }]
              : [],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: req.toPhone,
          type: 'text',
          text: { body: req.body ?? '' },
        };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Meta's error body is where the useful part is - a bare status tells
        // you nothing about which of the many rejection reasons applied.
        return { ok: false, error: `graph_${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
      }
      return { ok: true, providerId: data?.messages?.[0]?.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export function adapterFromEnv(env: Record<string, string | undefined>): WhatsAppAdapter {
  if (env.WHATSAPP_MODE !== 'cloud') return new MockAdapter();
  const id = env.WHATSAPP_PHONE_NUMBER_ID;
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) {
    // Falling back to mock here would be silent data loss dressed as success:
    // the messages table would fill with SENT rows nobody received.
    throw new Error('WHATSAPP_MODE=cloud but WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN is missing');
  }
  return new CloudApiAdapter(id, token);
}
