// Single action endpoint for coordinating Fast-Track viewing requests.
// Admin or the request's realtor confirms a schedule, suggests a change, or
// cancels - the request row is updated and the renter is notified in their
// chat thread (when one exists) and by email, so they never have to poll.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';
import { Resend } from 'npm:resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

type Action = 'confirm' | 'suggest' | 'cancel';

interface ScheduleSlot { date: string; time: string; property_title?: string }

function chatMessage(action: Action, message: string | undefined, schedule: ScheduleSlot[] | undefined, titles: string[]): string {
  const listings = titles.length > 0 ? titles.map((t) => `- ${t}`).join('\n') : '';
  if (action === 'confirm') {
    const slots = (schedule || []).map((s) => `- ${s.date} at ${s.time}${s.property_title ? ` - ${s.property_title}` : ''}`).join('\n');
    return `Your viewings are confirmed! 🎉\n\n${slots}\n${message ? `\n${message}` : ''}\nWe'll see you there - reply here if anything changes.`;
  }
  if (action === 'suggest') {
    return `About your viewing request${listings ? ` for:\n${listings}` : ''}\n\n${message || 'We need to adjust the schedule.'}\n\nReply here or update your request from your profile page.`;
  }
  return `Your viewing request${listings ? ` for:\n${listings}` : ''} has been cancelled.${message ? `\n\nReason: ${message}` : ''}\n\nYou can request new viewings anytime from Browse.`;
}

function emailHtml(action: Action, renterName: string, message: string | undefined, schedule: ScheduleSlot[] | undefined, titles: string[]): { subject: string; html: string } {
  const listingsHtml = titles.map((t) => `<li>${t}</li>`).join('');
  if (action === 'confirm') {
    const slots = (schedule || []).map((s) => `<li><b>${s.date}</b> at <b>${s.time}</b>${s.property_title ? ` - ${s.property_title}` : ''}</li>`).join('');
    return {
      subject: 'Your Hausto viewings are confirmed',
      html: `<h2>Hi ${renterName}, your viewings are confirmed! 🎉</h2><ul>${slots}</ul>${message ? `<p>${message}</p>` : ''}<p>Reply in your Hausto chat if anything changes.</p><p>- The Hausto team</p>`,
    };
  }
  if (action === 'suggest') {
    return {
      subject: 'Update on your Hausto viewing request',
      html: `<h2>Hi ${renterName},</h2><p>About your viewing request${titles.length ? ' for:' : ''}</p><ul>${listingsHtml}</ul><p>${message || 'We need to adjust the schedule.'}</p><p>Reply in your Hausto chat or update your request from your profile page.</p><p>- The Hausto team</p>`,
    };
  }
  return {
    subject: 'Your Hausto viewing request was cancelled',
    html: `<h2>Hi ${renterName},</h2><p>Your viewing request${titles.length ? ' for:' : ''}</p><ul>${listingsHtml}</ul><p>has been cancelled.${message ? ` Reason: ${message}` : ''}</p><p>You can request new viewings anytime from the Browse page.</p><p>- The Hausto team</p>`,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { requestId, action, message, schedule } = await req.json() as {
      requestId: string; action: Action; message?: string; schedule?: ScheduleSlot[];
    };
    if (!requestId || !['confirm', 'suggest', 'cancel'].includes(action)) {
      return json({ error: 'requestId and a valid action are required' }, 400);
    }
    if (action === 'confirm' && (!Array.isArray(schedule) || schedule.length === 0)) {
      return json({ error: 'confirm requires at least one schedule slot' }, 400);
    }

    // ── Authorize: service role, admin user, or the request's realtor ──
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: request, error: reqErr } = await admin
      .from('fast_track_requests').select('*').eq('id', requestId).maybeSingle();
    if (reqErr || !request) return json({ error: 'Request not found' }, 404);

    let actorId: string | null = null;
    if (token !== SERVICE_KEY) {
      const { data: userData } = await admin.auth.getUser(token);
      actorId = userData?.user?.id ?? null;
      if (!actorId) return json({ error: 'Unauthorized' }, 401);
      const { data: role } = await admin.from('user_roles')
        .select('role').eq('user_id', actorId).eq('role', 'admin').maybeSingle();
      const isAdmin = !!role;
      const isOwningRealtor = request.realtor_id && request.realtor_id === actorId;
      if (!isAdmin && !isOwningRealtor) return json({ error: 'Forbidden' }, 403);
    }

    // ── Context: renter + property titles ──
    const { data: renter } = await admin.from('profiles')
      .select('name, email').eq('id', request.renter_id).maybeSingle();
    const ids: string[] = request.property_ids || [];
    const titles: string[] = [];
    if (ids.length > 0) {
      const [ext, internal] = await Promise.all([
        admin.from('external_properties').select('id, title').in('id', ids),
        admin.from('properties').select('id, title').in('id', ids),
      ]);
      const map = new Map<string, string>();
      for (const p of [...(ext.data || []), ...(internal.data || [])]) map.set(p.id, p.title);
      for (const id of ids) { const t = map.get(id); if (t) titles.push(t); }
    }

    // ── Update the request ──
    const update: Record<string, unknown> = { notes: message?.trim() || null };
    if (action === 'confirm') {
      update.status = 'scheduled';
      update.scheduled_viewings = schedule;
    } else if (action === 'suggest') {
      update.status = 'in_progress';
    } else {
      update.status = 'cancelled';
    }
    const { error: updErr } = await admin.from('fast_track_requests').update(update).eq('id', requestId);
    if (updErr) return json({ error: `Update failed: ${updErr.message}` }, 500);


    // ── Notify: email (best-effort) ──
    let emailDelivered = false;
    if (renter?.email) {
      try {
        const { subject, html } = emailHtml(action, renter?.name || 'there', message, schedule, titles);
        await resend.emails.send({ from: 'Hausto <hello@hausto.com>', to: [renter.email], subject, html });
        emailDelivered = true;
      } catch (e) {
        console.warn('[fast-track-action] email failed:', String(e).substring(0, 200));
      }
    }

    // chatDelivered is retained as false: the in-app chat was retired, email is
    // the only delivery channel now.
    return json({ success: true, status: update.status, chatDelivered: false, emailDelivered });
  } catch (e) {
    console.error('[fast-track-action] Error:', e);
    return json({ error: (e as Error).message }, 500);
  }
});
