import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-PAYPAL-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    
    if (!clientId || !clientSecret) {
      throw new Error("PayPal credentials not configured");
    }
    logStep("PayPal credentials verified");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Get PayPal access token
    const authResponse = await fetch("https://api.sandbox.paypal.com/v1/oauth2/token", {
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

    // Check existing subscriber record
    const { data: subscriberData } = await supabaseClient
      .from("subscribers")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    let subscriptionStatus = {
      subscribed: false,
      subscription_tier: null as string | null,
      subscription_end: null as string | null,
    };

    if (subscriberData?.paypal_subscription_id) {
      logStep("Found PayPal subscription ID", { subscriptionId: subscriberData.paypal_subscription_id });
      
      // Check subscription status with PayPal
      const subscriptionResponse = await fetch(
        `https://api.sandbox.paypal.com/v1/billing/subscriptions/${subscriberData.paypal_subscription_id}`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (subscriptionResponse.ok) {
        const subscription = await subscriptionResponse.json();
        logStep("PayPal subscription status", { status: subscription.status });
        
        if (subscription.status === "ACTIVE") {
          subscriptionStatus = {
            subscribed: true,
            subscription_tier: "premium",
            subscription_end: subscription.billing_info?.next_billing_time || null,
          };
        }
      }
    } else {
      logStep("No PayPal subscription ID found");
    }

    // Update subscriber record
    await supabaseClient.from("subscribers").upsert({
      user_id: user.id,
      email: user.email,
      paypal_subscription_id: subscriberData?.paypal_subscription_id || null,
      subscribed: subscriptionStatus.subscribed,
      subscription_tier: subscriptionStatus.subscribed ? "premium" : "free",
      subscription_end: subscriptionStatus.subscription_end,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });

    logStep("Updated subscriber record", subscriptionStatus);

    return new Response(JSON.stringify(subscriptionStatus), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-paypal-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ 
      subscribed: false,
      subscription_tier: "free",
      subscription_end: null,
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});