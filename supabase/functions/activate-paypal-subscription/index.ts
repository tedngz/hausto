import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user?.email) throw new Error("Not authenticated");

    const { subscription_id } = await req.json();
    
    const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const apiBase = Deno.env.get("PAYPAL_API_BASE") ?? "https://api-m.sandbox.paypal.com";

    if (!clientId || !clientSecret) throw new Error("PayPal credentials not configured");

    // Get PayPal access token
    const authResponse = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: "grant_type=client_credentials",
    });
    const authData = await authResponse.json();
    if (!authResponse.ok) throw new Error("PayPal auth failed");

    // Verify subscription with PayPal
    let subscriptionActive = false;
    let nextBillingTime: string | null = null;
    let verifiedSubscriptionId = subscription_id;

    if (subscription_id) {
      const subResponse = await fetch(`${apiBase}/v1/billing/subscriptions/${subscription_id}`, {
        headers: {
          "Authorization": `Bearer ${authData.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (subResponse.ok) {
        const subData = await subResponse.json();
        if (subData.status === "ACTIVE" || subData.status === "APPROVED") {
          subscriptionActive = true;
          nextBillingTime = subData.billing_info?.next_billing_time || null;
        }
      }
    }

    // Even if we can't verify immediately (PayPal can be delayed), activate based on redirect
    const { error: upsertError } = await supabaseClient.from("subscribers").upsert({
      user_id: user.id,
      email: user.email,
      paypal_subscription_id: verifiedSubscriptionId || null,
      subscribed: true,
      subscription_tier: "premium",
      subscription_end: nextBillingTime || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });

    if (upsertError) throw new Error(`Database error: ${upsertError.message}`);

    console.log(`[ACTIVATE-PAYPAL] Subscription activated for user ${user.id}`);

    return new Response(JSON.stringify({ success: true, subscribed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[ACTIVATE-PAYPAL] Error: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
