// The realtor transport, and only the transport - the same split as
// `_shared/whatsapp/adapter.ts`.
//
// Everything that makes a message to a broker *correct* - persisted before it
// counts as sent, idempotent, carrying nothing about the renter - lives in
// send.ts. A channel receives an already-persisted message and tries to get it
// to the broker. Keeping the split means swapping how a message reaches Zalo
// cannot quietly change what is allowed into it.
//
// Today there is one channel, and it is a person. The operator sends on Zalo
// from their own phone and presses "Mark sent" in the console; by the time
// `deliver` is called, the message has already left. Two more are planned and
// deliberately not built here (AI operator plan, "Zalo: realtor side"):
//
//   - a bridge (a browser extension on web.zalo.me, or a small app on an
//     always-on device) that pre-fills the draft and captures the reply, with
//     a person still pressing send;
//   - Zalo OA / ZNS, once a Vietnam-registered entity exists.
//
// Both reopen scope CLAUDE.md currently closes ("any Zalo integration"), so
// they wait for that decision rather than arriving behind an interface.

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

export function realtorChannelFromEnv(env: Record<string, string | undefined>): RealtorChannel {
  const mode = (env.REALTOR_CHANNEL ?? '').trim();
  if (mode === '' || mode === 'manual') return new ManualChannel();
  // Refusing beats falling back. A misconfigured bridge silently treated as
  // manual would record every draft as SENT when nothing left the building.
  throw new Error(`REALTOR_CHANNEL=${mode} is not built. Only 'manual' exists - see _shared/realtor/channel.ts.`);
}
