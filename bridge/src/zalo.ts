// What the bridge needs from Zalo, and nothing more.
//
// Three operations: find the Zalo user behind an agent's phone number, send
// them text, and hear what they send back. Everything else the account can do
// is out of reach of this interface on purpose - the daemon reading a real
// account with real chats in it should be able to do exactly what its job is.
//
// The implementation is zalo-zca.ts, over the unofficial zca-js library. Tests
// use a fake.

export interface IncomingZalo {
  /** The sender's Zalo user id. The bridge maps it back to a phone it resolved. */
  fromUid: string;
  text: string;
  /** Image URLs, when the message is a photo (S7.2b). Its caption, if any, is `text`. */
  photos?: string[];
  /** Zalo's id for the message - Hausto's idempotency key for it. */
  msgId: string;
}

export interface ZaloClient {
  /** Log in and start listening. `onMessage` sees one-to-one messages from others only. */
  start(onMessage: (m: IncomingZalo) => void): Promise<void>;
  /** The Zalo user id for an E.164 number, or null if they are not on Zalo. */
  resolvePhone(phoneE164: string): Promise<string | null>;
  /** Send text to a user. Throws on failure. */
  send(uid: string, text: string): Promise<{ providerId?: string }>;
  stop(): Promise<void>;
}
