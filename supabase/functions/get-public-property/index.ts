import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const stripContact = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) out[k] = null;
  return out as T;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { id } = await req.json();
    if (!id || typeof id !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // No caller gets an agent's contact or the original listing from here,
    // signed in or not. Both lead to the agent - the source posting carries
    // the number - and the one path to an agent's number is the viewing-day
    // message (CLAUDE.md invariant 4). This reads with the service role, which
    // bypasses the column grants, so the strip below is the whole guarantee.
    const db = createClient(supabaseUrl, serviceKey);

    // Try internal properties first
    const { data: property } = await db
      .from('properties')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .gte('last_activated_at', new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString())
      .maybeSingle();

    if (property) {
      const { data: realtor } = await db
        .from('profiles')
        .select('id, name, avatar_url, bio')
        .eq('id', (property as any).realtor_id)
        .maybeSingle();

      const payload: any = {
        source: 'internal',
        property: stripContact(property as Record<string, unknown>, [
          'property_source_provider_name',
          'property_source_provider_phone',
          'property_source_link',
        ]),
        // Kept in the shape callers read, with the contact fields empty.
        realtor: realtor ? { ...realtor, phone: null, email: null } : null,
      };
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fallback: external_properties
    const { data: ext } = await db
      .from('external_properties')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .eq('raw_only', false)
      .maybeSingle();

    if (ext) {
      const property = {
        ...stripContact(ext as Record<string, unknown>, ['contact_name', 'contact_phone', 'source_url']),
        // Crawler scratch space - never part of the public payload.
        raw_data: undefined,
      };
      const payload: any = { source: 'external', property };
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('get-public-property error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
