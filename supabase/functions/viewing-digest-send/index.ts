// The alert sweep: the digest, and complex watches (SPEC §11).
//
//   POST { send: true }          - run 1, Tuesday 09:00: the digest and watches
//   POST { send: true, run: 2 }  - run 2, Friday 09:00: the digest alone
//
// The digest is a Pass benefit since the pricing rework, up to twice a week;
// watches stay weekly on both tiers. The sweep itself lives in
// `_shared/viewing/digest-sweep.ts`, and the consent rules in `digest.ts` and
// `watch.ts` are pure, so they cannot be quietly relaxed by a query in here.
// This function authenticates the cron and obeys.
//
// Defaults to a dry run: it reports how many renters WOULD be messaged. The
// crons pass `send: true` (migrations 20260928120000, 20261006150000).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { TEMPLATES } from '../_shared/whatsapp/templates.ts';
import { runDigestSweep } from '../_shared/viewing/digest-sweep.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = req.headers.get('x-cron-secret') || '';
  let authorized = token === SERVICE_ROLE;
  if (!authorized && cronSecret) {
    const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
    authorized = data === true;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  // Defaults to a dry run. A sweep that messages every opted-in renter is not
  // something to trigger by curling a URL without meaning to.
  const send = body?.send === true;
  const run = body?.run === 2 ? 2 : 1;

  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  try {
    const summary = await runDigestSweep(db, new SupabaseMessageStore(db), adapter, { run, send, now: new Date() });
    if (summary.refused > 0 && summary.sent === 0 && send) {
      const template = run === 2 ? TEMPLATES.NEW_PLACES.name : TEMPLATES.WEEKLY_DIGEST.name;
      console.log(
        `[viewing-digest-send] run ${run}: ${summary.eligible} renter(s) eligible, 0 sent - is "${template}" ` +
        'approved, and still APPROVED in whatsapp_template_status?',
      );
    }
    console.log(`[viewing-digest-send] ${JSON.stringify(summary)}`);
    return json({ success: true, ...summary });
  } catch (e) {
    console.error('[viewing-digest-send]', e);
    return json({ error: (e as Error).message }, 500);
  }
});
