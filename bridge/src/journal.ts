// The device's own record of what it sent, on disk.
//
// Hausto's claim lease stops two pulls sending one message. This stops the
// other double-send: the device sends, then dies before its ack lands, and
// after the lease the same message is handed out again. The journal is
// written the moment a send succeeds - before the ack - so on restart the
// device acks it as sent instead of sending it twice.
//
// It is also where the daily count comes from, so a restart does not reset
// the cap.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

interface Entry { messageId: string; at: string; providerId?: string }

/** The calendar day in Ho Chi Minh City, which is where "today" is for the cap. */
export function hcmcDay(t: Date): string {
  return new Date(t.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export class Journal {
  private readonly sent = new Map<string, Entry>();

  constructor(private readonly path: string | null) {
    if (path && existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as Entry;
          if (e.messageId) this.sent.set(e.messageId, e);
        } catch { /* a torn last line from a crash; the rest stands */ }
      }
    }
  }

  get(messageId: string): Entry | undefined {
    return this.sent.get(messageId);
  }

  record(messageId: string, at: Date, providerId?: string): void {
    const e: Entry = { messageId, at: at.toISOString(), ...(providerId ? { providerId } : {}) };
    this.sent.set(messageId, e);
    if (this.path) appendFileSync(this.path, JSON.stringify(e) + '\n');
  }

  sentOn(day: string): number {
    let n = 0;
    for (const e of this.sent.values()) if (hcmcDay(new Date(e.at)) === day) n++;
    return n;
  }
}
