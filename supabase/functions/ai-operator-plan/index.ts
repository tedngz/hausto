// The AI operator, stage 1: shadow mode. Proposes; never acts.
//
// Runs on pg_cron every 10 minutes over open requests, and on demand from the
// ops console for one request. It writes `operator_proposals` rows and nothing
// else - no events, no messages. An operator approving a proposal is what
// turns it into an action, through ops-record-outcome, under their own actor.
//
// The judgement is `_shared/viewing/planner.ts` (pure, tested); the loop is
// `_shared/viewing/plan-run.ts`. This file is auth, the model call for agent
// replies, and the spend guard.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { runPlanner } from '../_shared/viewing/plan-run.ts';
import { callParseModel } from '../_shared/viewing/parse-call.ts';
import { PARSE_MODEL } from '../_shared/viewing/parse-reply.ts';
import { isOpenAIBudgetExhausted, logOpenAIUsage } from '../_shared/openai-usage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';

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
  const canSpend = !!OPENAI_API_KEY && !(await isOpenAIBudgetExhausted());

  const result = await runPlanner(db, {
    requestIds,
    now: new Date(),
    parse: async ctx => {
      if (!canSpend) return null;
      const r = await callParseModel(ctx, OPENAI_API_KEY);
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
  });

  console.log(`[ai-operator-plan] scanned ${result.scanned}, proposed ${result.proposed}, superseded ${result.superseded}, parsed ${result.parsed}`);
  return json({ success: true, ...result });
});
