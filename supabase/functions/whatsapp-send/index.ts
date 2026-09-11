// Outbound WhatsApp. A thin wrapper: every rule lives in _shared/whatsapp/send.ts
// and this only translates HTTP into a call and back.
//
// Service role or cron secret only. Nothing renter-facing calls this directly -
// a renter who could name a phone and a body could send from our number.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import {
  sendFreeForm,
  sendTemplate,
  ServiceWindowClosedError,
  UnapprovedTemplateError,
  ConsecutiveMessageError,
} from '../_shared/whatsapp/send.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = req.headers.get('x-cron-secret') || '';
  let authorized = token === SERVICE_ROLE;
  if (!authorized && cronSecret) {
    const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
    authorized = data === true;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { renterId, requestId, purpose, attempt } = body as {
    renterId?: string; requestId?: string; purpose?: string; attempt?: number;
  };
  if (!renterId || !purpose) return json({ error: 'renterId and purpose are required' }, 400);

  const store = new SupabaseMessageStore(db);
  let adapter;
  try {
    adapter = adapterFromEnv(Deno.env.toObject());
  } catch (e) {
    // Half-configured cloud mode. Refusing is the point - see adapter.ts.
    return json({ error: (e as Error).message }, 500);
  }

  try {
    const result = body.templateName
      ? await sendTemplate(store, adapter, {
          renterId,
          requestId,
          purpose,
          attempt,
          templateName: String(body.templateName),
          params: Array.isArray(body.params) ? body.params.map(String) : [],
        })
      : await sendFreeForm(store, adapter, {
          renterId,
          requestId,
          purpose,
          attempt,
          body: String(body.body ?? ''),
        });

    return json({
      success: true,
      mode: adapter.mode,
      messageId: result.message.id,
      status: result.message.status,
      deduplicated: result.deduplicated,
    });
  } catch (e) {
    // These four are the contract refusing, not the function failing. They carry
    // distinct codes so a caller can branch - particularly on a shut window,
    // where the answer is to send a template, not to retry this.
    if (e instanceof ServiceWindowClosedError) {
      return json({ error: 'service_window_closed', message: e.message }, 409);
    }
    if (e instanceof UnapprovedTemplateError) {
      return json({ error: 'unapproved_template', message: e.message }, 400);
    }
    if (e instanceof ConsecutiveMessageError) {
      return json({ error: 'too_many_consecutive', message: e.message }, 429);
    }
    console.error('[whatsapp-send]', e);
    return json({ error: 'send_failed', message: (e as Error).message }, 500);
  }
});
