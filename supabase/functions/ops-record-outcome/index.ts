// The ops console's only write path (SPEC §4).
//
// Every state change an operator makes arrives here and becomes typed events.
// The console has SELECT and nothing else - see 20260911190000_ops_console_access.sql
// - so this is not a convenience wrapper the browser could route around. It is
// where invariant 2 is actually enforced.
//
// This file is the door: it proves the caller holds the `ops` role and stamps
// them as the actor. What each action does lives in
// `_shared/viewing/ops-actions.ts`, where it is tested, and where the AI
// operator will call the same actions under its own actor rather than a
// second copy of them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { performOpsAction } from '../_shared/viewing/ops-actions.ts';
import { opsActor } from '../_shared/viewing/outcomes.ts';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { realtorChannelFromEnv } from '../_shared/realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../_shared/realtor/store.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Who is this, and are they ops? ────────────────────────────────────────
  // An operator, never the service role. Every event here carries OPS:<uuid>,
  // and an action nobody is attributable for is one the corpus cannot be
  // audited against later.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const { data: userData } = await db.auth.getUser(token);
  const actorId = userData?.user?.id ?? null;
  if (!actorId) return json({ error: 'Unauthorized' }, 401);

  const { data: role } = await db
    .from('user_roles').select('role').eq('user_id', actorId).eq('role', 'ops').maybeSingle();
  if (!role) return json({ error: 'Forbidden' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  try {
    const env = Deno.env.toObject();
    const result = await performOpsAction(
      db,
      {
        whatsapp: adapterFromEnv(env),
        messages: new SupabaseMessageStore(db),
        realtorChannel: realtorChannelFromEnv(env),
        realtorMessages: new SupabaseRealtorMessageStore(db),
      },
      opsActor(actorId),
      body,
    );
    return json(result.body, result.status);
  } catch (e) {
    console.error('[ops-record-outcome] failed:', e);
    return json({ error: 'internal', message: (e as Error).message }, 500);
  }
});
