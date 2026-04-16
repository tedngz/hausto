import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    if (!subscription_id) {
      throw new Error("Missing subscription_id");
    }

    const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const apiBase = Deno.env.get("PAYPAL_API_BASE") ?? "https://api-m.sandbox.paypal.com";

    if (!clientId || !clientSecret) {
      throw new Error("PayPal credentials not configured");
    }

    // Verify the subscription is actually ACTIVE on PayPal before activating
    const authResp = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: "grant_type=client_credentials",
    });

    if (!authResp.ok) {
      throw new Error("Failed to authenticate with PayPal");
    }

    const { access_token } = await authResp.json();
    const subResp = await fetch(`${apiBase}/v1/billing/subscriptions/${subscription_id}`, {
      headers: { "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" },
    });

    if (!subResp.ok) {
      throw new Error("Invalid PayPal subscription ID");
    }

    const subData = await subResp.json();
    const status = subData.status;

    // Only activate if PayPal confirms the subscription is ACTIVE or APPROVED
    if (status !== "ACTIVE" && status !== "APPROVED") {
      throw new Error(`PayPal subscription is not active (status: ${status})`);
    }

    const nextBillingTime: string | null = subData.billing_info?.next_billing_time || null;

    const { error: upsertError } = await supabaseClient.from("subscribers").upsert({
      user_id: user.id,
      email: user.email,
      paypal_subscription_id: subscription_id || null,
      subscribed: true,
      subscription_tier: "premium",
      subscription_end: nextBillingTime || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });

    if (upsertError) throw new Error(upsertError.message);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ACTIVATE-PAYPAL]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
