// The realtor transport, and only the transport - the same split as
// `_shared/whatsapp/adapter.ts`.
//
// Everything that makes a message to a broker *correct* - persisted before it
// counts as sent, idempotent, carrying nothing about the renter - lives in
// send.ts. A channel receives an already-persisted message and tries to get it
// to the broker. Keeping the split means swapping how a message reaches Zalo
// cannot quietly change what is allowed into it.
//
// Two channels. Manual is a person: the operator sends on Zalo from their own
// phone and presses "Mark sent"; by the time `deliver` is called the message
// has already left. Bridge is the always-on device the owner chose on
// 2026-09-27 (AI operator plan, stage 3): approving in the console queues the
// message, and the device sends it. REALTOR_CHANNEL picks one.
//
// Zalo OA / ZNS stays unbuilt until a Vietnam-registered entity exists.

/** The medium the broker was reached on - recorded on every message. */
export const REALTOR_MEDIA = ['ZALO', 'PHONE', 'WHATSAPP', 'SMS'] as const;
export type RealtorMedium = typeof REALTOR_MEDIA[number];

export interface RealtorDeliveryRequest {
  /** The `realtor_messages` row id, already persisted. */
  messageId: string;
  medium: RealtorMedium;
  body: string;
}

export interface RealtorDeliveryResult {
  ok: boolean;
  /**
   * SENT when the message has left; QUEUED when a transport will send it later
   * (a bridge picking up approved drafts). Manual is always SENT - see below.
   */
  state: 'SENT' | 'QUEUED';
  providerId?: string;
  error?: string;
}

export interface RealtorChannel {
  readonly mode: 'manual' | 'bridge' | 'zalo_oa';
  deliver(req: RealtorDeliveryRequest): Promise<RealtorDeliveryResult>;
}

/**
 * A person on Zalo. The default, and today the only channel.
 *
 * It sends nothing, because the operator already has: the console calls this
 * when they press "Mark sent", after the message went out from their phone.
 * What it contributes is that the words they sent are now a row - the
 * transcript that paste-parse, and later the bridge, are trained against.
 */
export class ManualChannel implements RealtorChannel {
  readonly mode = 'manual' as const;
  /** Exposed so tests can assert what was recorded. */
  readonly delivered: RealtorDeliveryRequest[] = [];

  deliver(req: RealtorDeliveryRequest): Promise<RealtorDeliveryResult> {
    this.delivered.push(req);
    return Promise.resolve({ ok: true, state: 'SENT' });
  }
}

/**
 * The always-on device (bridge/, stage 3). Sends nothing from here: it leaves
 * the row QUEUED, the device claims it through the zalo-bridge function,
 * sends it from the business's Zalo account, and acks it. The event the send
 * stands for is written on that ack, so "contacted" means the agent was sent
 * something, not that a button was pressed.
 */
export class BridgeChannel implements RealtorChannel {
  readonly mode = 'bridge' as const;
  deliver(): Promise<RealtorDeliveryResult> {
    return Promise.resolve({ ok: true, state: 'QUEUED' });
  }
}

export function realtorChannelFromEnv(env: Record<string, string | undefined>): RealtorChannel {
  const mode = (env.REALTOR_CHANNEL ?? '').trim();
  if (mode === '' || mode === 'manual') return new ManualChannel();
  if (mode === 'bridge') return new BridgeChannel();
  // Refusing beats falling back. A misconfigured channel silently treated as
  // manual would record every draft as SENT when nothing left the building.
  throw new Error(`REALTOR_CHANNEL=${mode} is not a channel. Use 'manual' or 'bridge' - see _shared/realtor/channel.ts.`);
}
