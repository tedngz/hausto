// A one-off end-to-end check of the Zalo side, through the bridge's own
// adapter: find a number on Zalo, send it one message, wait for its reply.
// Bypasses Hausto entirely - nothing reaches request data or transcripts.
//
//   ZALO_CREDENTIALS_FILE=... node --experimental-transform-types src/smoke.ts +84901234567 "message"
//
// Stop the bridge service first: two connections on one Zalo session can
// knock each other off.

import { ZcaClient } from './zalo-zca.ts';

const phone = process.argv[2];
const text = process.argv[3];
const WAIT_MS = 2 * 60_000;
if (!phone || !text) {
  console.error('usage: smoke.ts +84XXXXXXXXX "message"');
  process.exit(1);
}

const client = new ZcaClient(process.env.ZALO_CREDENTIALS_FILE || '/opt/hausto-bridge/state/credentials.json');
let uid: string | null = null;

function finish(code: number): never {
  void client.stop();
  process.exit(code);
}

await client.start(m => {
  if (uid && m.fromUid === uid) {
    console.log(`[smoke] reply received from that number: "${m.text.slice(0, 120)}"`);
    finish(0);
  }
});
console.log('[smoke] logged in and listening');

uid = await client.resolvePhone(phone);
if (!uid) {
  console.error('[smoke] that number was not found on Zalo');
  finish(1);
}
console.log('[smoke] number found on Zalo');

const sent = await client.send(uid!, text);
console.log(`[smoke] message sent${sent.providerId ? ` (Zalo message id ${sent.providerId})` : ''} - waiting up to 2 minutes for a reply`);

setTimeout(() => {
  console.log('[smoke] no reply within 2 minutes - sending works; check the reply arrived on the phone side');
  finish(2);
}, WAIT_MS);
