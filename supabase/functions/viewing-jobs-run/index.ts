// Running the jobs the drain enqueued.
//
// Separate from the drain on purpose: a slow send must not stall the scan, and
// a job that fails should be retried from its row rather than lost with the
// pass that produced it.
//
// **It only runs the renter-facing sends.** NUDGE_REALTOR, RESOLVE_REALTOR,
// CONFIRM_REALTOR and RELEASE_REALTOR are enqueued by the drain and by ops
// actions, and they stay pending until a
// person does them - the realtor channel is Zalo and Zalo is a human this
// quarter (CLAUDE.md). Writing ITEM_NUDGED here would be worse than useless:
// it feeds the two-nudge floor on NO_RESPONSE (SPEC §4), so a job auto-nudging
// nobody would let an operator close an item as unresponsive when the broker
// was never actually chased. That is a poisoned row in the corpus the whole
// ops console exists to produce.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { deliver } from '../_shared/viewing/deliver.ts';
import { INQUIRY_DEADLINE_JOB } from '../_shared/viewing/inquiry-deadline.ts';
import { runInquiryDeadline } from '../_shared/viewing/concierge.ts';
import { sendIntakeAlert } from '../_shared/viewing/ops-alert.ts';
import { sendViewingDay } from '../_shared/viewing/viewing-day.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Kinds this runner owns. Everything else is somebody's to-do, not a task. */
const AUTOMATED_KINDS = ['HOLDING_UPDATE', 'VIEWING_DAY', INQUIRY_DEADLINE_JOB];

/** A viewing-day refusal no retry can change: done, with the reason on the row. */
const VIEWING_DAY_FINAL = new Set(['unknown_request', 'not_due', 'too_many_consecutive', 'template_unavailable']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface Job {
  id: string;
  kind: string;
  attempts: number;
  payload: { request_id?: string; item_id?: string | null; reason?: string };
}

/**
 * After this many failures a job stops being retried.
 *
 * Not silently: it is completed with the error recorded, because a row that
 * retries forever every 15 minutes is a bill and a log nobody reads, and one
 * that vanishes is a renter nobody hears from again. The silence watch will
 * re-enqueue a fresh job on the next pass if the request is still owed
 * something, which is the right recovery - a new attempt at the current state,
 * not a replay of an old one.
 */
const MAX_ATTEMPTS = 5;

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

  // A runner that died mid-flight leaves rows locked forever. Every send
  // behind them is idempotent, so reclaiming is safe.
  const { data: unstuck } = await db.rpc('unstick_jobs', { _older_than: '1 hour' });

  const { data: claimed, error: claimErr } = await db.rpc('claim_jobs', {
    _kinds: AUTOMATED_KINDS,
    _limit: 20,
  });
  if (claimErr) return json({ error: claimErr.message }, 500);

  const jobs = (claimed ?? []) as Job[];
  if (jobs.length === 0) return json({ success: true, unstuck: unstuck ?? 0, ran: 0 });

  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    // An availability request's 16h/22h reminder (PLAN-v3 S7.1c): an email to
    // the ops team, only if nobody has answered yet. Never retried into a
    // second email - a reminder that failed is logged, not repeated.
    if (job.kind === INQUIRY_DEADLINE_JOB) {
      const inquiryId = (job.payload as { inquiry_id?: string })?.inquiry_id;
      const outcome = inquiryId
        ? await runInquiryDeadline(db, inquiryId, new Date(), a => sendIntakeAlert(db, a, Deno.env.get('RESEND_API_KEY')))
            .catch((e: Error) => `error: ${e.message}`)
        : 'MISSING';
      await db.from('jobs').update({
        completed_at: new Date().toISOString(),
        last_error: outcome === 'SENT' ? null : outcome,
      }).eq('id', job.id);
      if (outcome === 'SENT') sent++; else skipped++;
      continue;
    }

    const requestId = job.payload?.request_id;
    if (!requestId) {
      await db.from('jobs').update({ completed_at: new Date().toISOString(), last_error: 'no request_id' }).eq('id', job.id);
      skipped++;
      continue;
    }

    try {
      // The morning of a kept viewing (viewing-day.ts): one message for the
      // renter's whole day, whichever of their requests' jobs gets here first.
      if (job.kind === 'VIEWING_DAY') {
        const day = await sendViewingDay(db, adapter, {
          requestId, now: new Date(), attempt: job.attempts, actor: 'SYSTEM',
        });
        if (day.ok || VIEWING_DAY_FINAL.has(day.code)) {
          await db.from('jobs').update({
            completed_at: new Date().toISOString(),
            last_error: day.ok ? null : day.code,
          }).eq('id', job.id);
          if (day.ok) sent++; else skipped++;
          continue;
        }
        throw new Error(`${day.code}: ${day.message}`);
      }

      const result = await deliver(db, adapter, {
        requestId,
        purpose: 'HOLDING_UPDATE',
        // The attempt is the job's own retry count, so a retry reuses the same
        // idempotency key only when it is genuinely the same attempt.
        attempt: job.attempts,
        actor: 'SYSTEM',
      });

      if (result.ok) {
        await db.from('jobs').update({ completed_at: new Date().toISOString() }).eq('id', job.id);
        sent++;
        continue;
      }

      // A shut window, or two messages already unanswered, is not a transient
      // fault and retrying cannot fix it - only the renter writing can.
      // Complete the job with the reason recorded rather than burning five
      // attempts discovering the same thing; the drain holds the next one
      // until they write (holdingUpdateOnHold).
      if (result.code === 'service_window_closed' || result.code === 'too_many_consecutive'
        || result.code === 'unknown_request') {
        await db.from('jobs')
          .update({ completed_at: new Date().toISOString(), last_error: result.code })
          .eq('id', job.id);
        skipped++;
        continue;
      }

      throw new Error(`${result.code}: ${result.message}`);
    } catch (e) {
      failed++;
      const message = (e as Error).message;
      if (job.attempts >= MAX_ATTEMPTS) {
        await db.from('jobs')
          .update({ completed_at: new Date().toISOString(), last_error: `gave up after ${job.attempts}: ${message}` })
          .eq('id', job.id);
        console.error(`[viewing-jobs-run] giving up on ${job.id}:`, message);
      } else {
        await db.rpc('release_job', { _id: job.id, _error: message });
        console.warn(`[viewing-jobs-run] ${job.id} failed (attempt ${job.attempts}):`, message);
      }
    }
  }

  console.log(`[viewing-jobs-run] ran ${jobs.length}: ${sent} sent, ${skipped} skipped, ${failed} failed`);
  return json({ success: true, unstuck: unstuck ?? 0, ran: jobs.length, sent, skipped, failed });
});
