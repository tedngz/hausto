// The Zalo bridge daemon. Runs on the always-on device; see README.md.

import { Bridge } from './bridge.ts';
import { Journal } from './journal.ts';
import { HttpHaustoApi } from './hausto.ts';
import { ZcaClient } from './zalo-zca.ts';

const VERSION = '0.3.0';

function env(name: string, fallback?: string): string {
  const v = (process.env[name] ?? fallback ?? '').trim();
  if (!v) {
    console.error(`[bridge] ${name} is required - see README.md`);
    process.exit(1);
  }
  return v;
}

const url = env('HAUSTO_BRIDGE_URL', 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/zalo-bridge');
const token = env('ZALO_BRIDGE_TOKEN');
if (token.length < 32) {
  console.error('[bridge] ZALO_BRIDGE_TOKEN must be at least 32 characters, and match the Supabase secret');
  process.exit(1);
}

// Each check-in is a function call and a handful of queries on Supabase's free
// plan, and at every 30 seconds they were the largest share of the project's
// logs (2026-11-03). An approved message waits at most this long; a reply from
// an agent does not wait at all - it wakes the loop (below).
const pollMs = Number(process.env.POLL_MS ?? 120_000);
/** After a reply wakes the loop, this long for the rest of a burst to arrive, so it goes in one call. */
const REPLY_SETTLE_MS = 5_000;

let wake: (() => void) | null = null;
function nap(ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => { wake = null; resolve(); };
    const timer = setTimeout(done, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      setTimeout(resolve, REPLY_SETTLE_MS);
    };
  });
}

const bridge = new Bridge(
  new HttpHaustoApi(url, token),
  new ZcaClient(env('ZALO_CREDENTIALS_FILE', './credentials.json')),
  new Journal(env('JOURNAL_FILE', './journal.jsonl')),
  {
    device: env('DEVICE_LABEL', 'zalo-bridge'),
    version: VERSION,
    dailyCap: Number(process.env.DAILY_CAP ?? 60),
    minGapMs: Number(process.env.MIN_GAP_MS ?? 20_000),
    resolvePerPass: Number(process.env.RESOLVE_PER_PASS ?? 3),
    watchRefreshMs: Number(process.env.WATCH_REFRESH_MS ?? 600_000),
    onIncoming: () => wake?.(),
  },
);

let stopping = false;
let failures = 0;

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const r = await bridge.pass();
      failures = 0;
      if (r.sent || r.failed || r.forwarded) {
        console.log(`[bridge] sent ${r.sent}, failed ${r.failed}, forwarded ${r.forwarded}${r.capped ? ' (daily cap reached)' : ''}`);
      }
    } catch (e) {
      failures += 1;
      console.error(`[bridge] pass failed (${failures} in a row):`, (e as Error).message);
      // Let the supervisor (systemd, pm2) restart with a clean Zalo session
      // rather than looping forever on a broken one.
      if (failures >= 10) process.exit(1);
    }
    await nap(pollMs);
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { stopping = true; setTimeout(() => process.exit(0), 2_000); });
}

console.log(`[bridge] ${VERSION} starting, polling every ${pollMs / 1000}s`);
await bridge.start();
await loop();
