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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Detect signed-in caller and keep their token: contact details are
    // released by asking the database as that user, not by deciding here.
    const authHeader = req.headers.get('authorization');
    let isAuthenticated = false;
    let userToken: string | null = null;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      if (token !== anonKey && token.length > 100) {
        const authClient = createClient(supabaseUrl, anonKey);
        const { data, error } = await authClient.auth.getUser(token);
        if (!error && data?.user) {
          isAuthenticated = true;
          userToken = token;
        }
      }
    }

    // The single source of truth for who may see an external listing's contact
    // details is get_external_property_contacts: admins, and the renter matched
    // to that listing. This endpoint reads with the service role, which bypasses
    // both RLS and the column grants, so it must not decide for itself - it
    // calls the RPC as the caller and takes whatever comes back. Not entitled,
    // or not signed in, means no rows and the fields stay null.
    const contactsForCaller = async (rpc: string, propertyId: string) => {
      if (!userToken) return null;
      try {
        const asUser = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${userToken}` } },
          auth: { persistSession: false },
        });
        const { data, error } = await asUser.rpc(rpc, { _property_ids: [propertyId] });
        if (error) {
          console.warn(`[get-public-property] ${rpc} failed:`, error.message);
          return null;
        }
        return (data as any[] | null)?.[0] ?? null;
      } catch (e) {
        console.warn(`[get-public-property] ${rpc} threw:`, String(e).substring(0, 120));
        return null;
      }
    };

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
        .select('id, name, phone, email, avatar_url, bio, allow_contact_sharing')
        .eq('id', (property as any).realtor_id)
        .maybeSingle();

      // Same delegation as the external branch: the source contact on an
      // internal listing is released by get_property_contacts - admin, the
      // owning realtor, or the renter matched to it. The realtor's own phone
      // and email ride along only for those callers, and only if they opted
      // into sharing.
      const internalContacts = await contactsForCaller('get_property_contacts', id);
      const entitled = internalContacts !== null;

      const payload: any = {
        source: 'internal',
        property: {
          ...stripContact(property as Record<string, unknown>, [
            'property_source_provider_name',
            'property_source_provider_phone',
          ]),
          ...(entitled
            ? {
                property_source_provider_name: internalContacts.property_source_provider_name ?? null,
                property_source_provider_phone: internalContacts.property_source_provider_phone ?? null,
              }
            : {}),
        },
        realtor,
      };

      if (payload.realtor && !(entitled && payload.realtor.allow_contact_sharing)) {
        payload.realtor = { ...payload.realtor, phone: null, email: null };
      }
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
      // Strip first, then hand back only what the RPC releases to this caller.
      const contacts = await contactsForCaller('get_external_property_contacts', id);
      const property = {
        ...stripContact(ext as Record<string, unknown>, ['contact_name', 'contact_phone']),
        ...(contacts
          ? { contact_name: contacts.contact_name ?? null, contact_phone: contacts.contact_phone ?? null }
          : {}),
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
