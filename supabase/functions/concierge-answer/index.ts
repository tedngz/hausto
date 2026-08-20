// Realtor answers an escalated renter question. Enriches the reply with the
// question it answers and a link to the property, delivers it into the renter's
// chat thread, marks the escalation answered, and emails the renter so they see
// the answer even when they're not in the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';
import { Resend } from 'npm:resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BASE_URL = 'https://hausto.com';
const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { escalationId, reply } = await req.json() as { escalationId: string; reply: string };
    if (!escalationId || !reply?.trim()) return json({ error: 'escalationId and reply are required' }, 400);

    const { data: esc, error: escErr } = await admin
      .from('concierge_escalations').select('*').eq('id', escalationId).maybeSingle();
    if (escErr || !esc) return json({ error: 'Escalation not found' }, 404);

    // Authorize: service role, admin, or the escalation's realtor
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let actorId: string | null = null;
    if (token !== SERVICE_KEY) {
      const { data: userData } = await admin.auth.getUser(token);
      actorId = userData?.user?.id ?? null;
      if (!actorId) return json({ error: 'Unauthorized' }, 401);
      const { data: role } = await admin.from('user_roles')
        .select('role').eq('user_id', actorId).eq('role', 'admin').maybeSingle();
      if (!role && esc.realtor_id !== actorId) return json({ error: 'Forbidden' }, 403);
    }

    // Property context (escalations reference a single property)
    let propTitle = '', propUrl = '';
    if (esc.property_id) {
      const [ext, int] = await Promise.all([
        admin.from('external_properties').select('title').eq('id', esc.property_id).maybeSingle(),
        admin.from('properties').select('title').eq('id', esc.property_id).maybeSingle(),
      ]);
      propTitle = ext.data?.title || int.data?.title || '';
      if (propTitle) propUrl = `${BASE_URL}/property/${esc.property_id}`;
    }

    // The in-app chat was retired, so email is the only delivery channel.
    await admin.from('concierge_escalations')
      .update({ status: 'answered' }).eq('id', escalationId);

    // Email the renter (best-effort)
    let emailDelivered = false;
    const { data: renter } = await admin.from('profiles')
      .select('name, email').eq('id', esc.renter_id).maybeSingle();
    if (renter?.email) {
      try {
        const propHtml = propUrl
          ? `<p style="margin-top:16px">About <a href="${propUrl}">${propTitle}</a></p>`
          : '';
        await resend.emails.send({
          from: 'Hausto <hello@hausto.com>',
          to: [renter.email],
          subject: 'A realtor answered your question on Hausto',
          html: `<h2>Hi ${renter.name || 'there'},</h2>`
            + `<p>You asked:</p><blockquote style="border-left:3px solid #f97316;padding-left:12px;color:#555">${esc.question}</blockquote>`
            + `<p><b>The realtor replied:</b></p><p>${reply.trim().replace(/\n/g, '<br>')}</p>`
            + propHtml
            + `<p style="margin-top:16px">Open Hausto to continue the conversation.</p><p>- The Hausto team</p>`,
        });
        emailDelivered = true;
      } catch (e) {
        console.warn('[concierge-answer] email failed:', String(e).substring(0, 200));
      }
    }

    return json({ success: true, emailDelivered });
  } catch (e) {
    console.error('[concierge-answer] Error:', e);
    return json({ error: (e as Error).message }, 500);
  }
});
