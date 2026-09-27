// Log the bridge in to Zalo by QR code, and save the session it will run on.
//
// Run on the server, as the bridge user, by deploy/login.sh - which fetches the
// QR image to your screen while this waits. Scan it with the Zalo app of the
// account the bridge should use (Zalo > the QR icon > scan), then confirm the
// login on that phone.
//
// The session (cookie, imei, userAgent) is written straight to
// credentials.json with owner-only permissions and never printed. It is a
// login to that Zalo account: it stays on this server.

import { writeFileSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Zalo, LoginQRCallbackEventType, type LoginQRCallbackEvent } from 'zca-js';

const credentialsPath = process.env.ZALO_CREDENTIALS_FILE || '/opt/hausto-bridge/state/credentials.json';
const qrPath = join(dirname(credentialsPath), 'qr.png');

/** A QR code lasts about a minute; after this many fresh ones, give up. */
const MAX_QR = 5;
/** And give up entirely after this long, rather than wait on a phone nobody picks up. */
const DEADLINE_MS = 6 * 60_000;

let shown = 0;
const deadline = setTimeout(() => {
  console.error('[login] no login within 6 minutes - run it again when the phone is at hand.');
  cleanup();
  process.exit(1);
}, DEADLINE_MS);

function cleanup(): void {
  rmSync(qrPath, { force: true });
}

function save(info: { cookie: unknown; imei: string; userAgent: string }): void {
  // Written beside the target and renamed over it, so a half-written session
  // is never what the bridge reads.
  const tmp = `${credentialsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify({ cookie: info.cookie, imei: info.imei, userAgent: info.userAgent }), { mode: 0o600 });
  renameSync(tmp, credentialsPath);
}

const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });

try {
  await zalo.loginQR({ qrPath }, async (event: LoginQRCallbackEvent) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        shown += 1;
        await event.actions.saveToFile(qrPath);
        console.log(`[login] QR code ready (${shown}/${MAX_QR}) - scan it with the Zalo app of the account to use.`);
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        if (shown >= MAX_QR) {
          console.error('[login] the QR code expired too many times - run it again when the phone is at hand.');
          event.actions.abort();
          return;
        }
        console.log('[login] QR code expired - making a fresh one.');
        event.actions.retry();
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        // The name is the account's own display name, shown so you can check
        // the right account scanned before confirming on the phone.
        console.log(`[login] scanned by "${event.data.display_name}" - confirm the login on that phone.`);
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        console.error('[login] the login was declined on the phone.');
        event.actions.abort();
        break;
      case LoginQRCallbackEventType.GotLoginInfo:
        save(event.data);
        console.log(`[login] session saved to ${credentialsPath} (owner-only). It is not printed anywhere.`);
        break;
    }
  });
} catch (e) {
  console.error('[login] failed:', (e as Error).message);
  cleanup();
  process.exit(1);
}

clearTimeout(deadline);
cleanup();
process.exit(0);
