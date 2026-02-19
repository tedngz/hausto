import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[REACTIVATE-PAYPAL-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const apiBase = Deno.env.get("PAYPAL_API_BASE") ?? "https://api-m.sandbox.paypal.com";

    if (!clientId || !clientSecret) {
      throw new Error("PayPal credentials not configured");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);

    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");
    logStep("User authenticated", { userId: user.id });

    // Get subscriber record
    const { data: subscriberData, error: subscriberError } = await supabaseClient
      .from("subscribers")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (subscriberError || !subscriberData) {
      throw new Error("No subscription record found");
    }

    if (!subscriberData.paypal_subscription_id) {
      throw new Error("No PayPal subscription to reactivate. Please create a new subscription.");
    }

    logStep("Found subscription", { 
      paypalId: subscriberData.paypal_subscription_id,
      tier: subscriberData.subscription_tier 
    });

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
    if (!authResponse.ok) {
      throw new Error(`PayPal auth failed: ${authData.error_description}`);
    }
    logStep("PayPal access token obtained");

    const accessToken = authData.access_token;

    // Reactivate the suspended subscription
    const activateResponse = await fetch(
      `${apiBase}/v1/billing/subscriptions/${subscriberData.paypal_subscription_id}/activate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          reason: "User requested reactivation",
        }),
      }
    );

    if (!activateResponse.ok) {
      const errorText = await activateResponse.text();
      logStep("PayPal reactivation failed", { status: activateResponse.status, error: errorText });
      throw new Error(`PayPal reactivation failed: ${errorText}`);
    }

    logStep("PayPal subscription reactivated successfully");

    // Get updated subscription details for billing date
    const subDetailResponse = await fetch(
      `${apiBase}/v1/billing/subscriptions/${subscriberData.paypal_subscription_id}`,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
      }
    );

    let nextBillingTime: string | null = null;
    if (subDetailResponse.ok) {
      const subData = await subDetailResponse.json();
      nextBillingTime = subData.billing_info?.next_billing_time || null;
      logStep("Got subscription details", { nextBillingTime, status: subData.status });
    }

    // Update subscriber record
    const { error: updateError } = await supabaseClient.from("subscribers").update({
      subscribed: true,
      subscription_tier: "premium",
      subscription_end: nextBillingTime || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id);

    if (updateError) {
      throw new Error(`Database update failed: ${updateError.message}`);
    }

    logStep("Subscription reactivated successfully");

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Subscription reactivated successfully" 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
