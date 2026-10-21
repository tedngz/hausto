// The AI operator. Stage 1 (shadow): proposes, and people decide. Stage 2:
// may also run renter replies itself, when every lock in autonomy.ts is open.
//
// Runs on pg_cron every 10 minutes over open requests, and on demand from the
// ops console for one request. With every lock shut - the state it ships in -
// it writes `operator_proposals` rows and nothing else, and an operator
// approving one is what turns it into an action, under their own actor. With a
// lock open, a qualifying proposal that no one took during its hold runs as
// AGENT:<version>, through the same performOpsAction a person's action does.
//
// The judgement is `_shared/viewing/planner.ts`, the locks `autonomy.ts`
// (both pure, tested); the loop is `plan-run.ts`. This file is auth, the model
// calls, the spend guard and the transports.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { runPlanner, loadAutonomyState } from '../_shared/viewing/plan-run.ts';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { realtorChannelFromEnv } from '../_shared/realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../_shared/realtor/store.ts';
import { callParseModel } from '../_shared/viewing/parse-call.ts';
import { PARSE_MODEL } from '../_shared/viewing/parse-reply.ts';
import { callDraftModel } from '../_shared/viewing/reply-call.ts';
import { REPLY_MODEL } from '../_shared/viewing/renter-reply.ts';
import { isOpenAIBudgetExhausted, logOpenAIUsage } from '../_shared/openai-usage.ts';
import { hasClaudeKey } from '../_shared/claude.ts';

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

  // Service role, the cron secret, or an operator refreshing one request.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let authorized = token === SERVICE_ROLE;
  const cronSecret = req.headers.get('x-cron-secret') || '';
  if (!authorized && cronSecret) {
    const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
    authorized = data === true;
  }
  if (!authorized && token) {
    const { data: userData } = await db.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userId) {
      const { data: role } = await db
        .from('user_roles').select('role').eq('user_id', userId).eq('role', 'ops').maybeSingle();
      authorized = !!role;
    }
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is the cron's */ }
  const requestIds = typeof body.requestId === 'string' && body.requestId ? [body.requestId] : undefined;

  // Checked once per run. A reply the model cannot read today becomes an
  // escalation, which is what a person would have had to handle anyway.
  const canSpend = hasClaudeKey() && !(await isOpenAIBudgetExhausted());

  // Stage 2's locks, read fresh every pass. With AI_OPERATOR_AUTONOMY unset
  // every action is closed and this runs as shadow mode exactly.
  const now = new Date();
  const env = Deno.env.toObject();
  const state = await loadAutonomyState(db, env.AI_OPERATOR_AUTONOMY, now, {
    realtorChannel: (env.REALTOR_CHANNEL || 'manual').trim() || 'manual',
  });
  const anyOpen = Object.values(state.actions).some(a => a.open);
  let autonomy;
  if (anyOpen) {
    try {
      autonomy = {
        state,
        deps: {
          whatsapp: adapterFromEnv(env),
          messages: new SupabaseMessageStore(db),
          realtorChannel: realtorChannelFromEnv(env),
          realtorMessages: new SupabaseRealtorMessageStore(db),
        },
      };
    } catch (e) {
      // A misconfigured transport is a reason not to act, never a reason to
      // act on a fallback.
      console.error('[ai-operator-plan] autonomy disabled this pass:', (e as Error).message);
    }
  }

  const result = await runPlanner(db, {
    requestIds,
    now,
    autonomy,
    parse: async ctx => {
      if (!canSpend) return null;
      const r = await callParseModel(ctx);
      if (!r.ok) {
        console.warn('[ai-operator-plan] reply parse failed:', r.error);
        return null;
      }
      logOpenAIUsage({
        fn: 'ai-operator-plan', model: PARSE_MODEL,
        usage: r.usage as { prompt_tokens?: number; completion_tokens?: number } | null,
      });
      return r.suggestion;
    },
    draft: async ctx => {
      if (!canSpend) return null;
      const r = await callDraftModel(ctx);
      if (!r.ok) {
        console.warn('[ai-operator-plan] renter draft failed:', r.error);
        return null;
      }
      logOpenAIUsage({
        fn: 'ai-operator-plan', model: REPLY_MODEL,
        usage: r.usage as { prompt_tokens?: number; completion_tokens?: number } | null,
        metadata: { kind: 'renter_draft' },
      });
      return r.draft;
    },
  });

  console.log(`[ai-operator-plan] scanned ${result.scanned}, proposed ${result.proposed}, superseded ${result.superseded}, parsed ${result.parsed}, drafted ${result.drafted}, executed ${result.executed}`);
  return json({ success: true, ...result });
});
