import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PAYPAL-SUBSCRIPTION] ${step}${detailsStr}`);
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

    const apiBase = Deno.env.get("PAYPAL_API_BASE") ?? "https://api-m.sandbox.paypal.com";
    const planId = Deno.env.get("PAYPAL_PLAN_ID");
    if (!planId) {
      throw new Error("PAYPAL_PLAN_ID not configured");
    }
    logStep("Using PayPal API base", { apiBase, hasPlanId: true });

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
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

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
    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/$/, '') || '';
    const returnUrl = `${origin}/subscription-success?subscription_id={SUBSCRIPTION_ID}`;
    const cancelUrl = `${origin}/subscription-cancel`;

    // Create PayPal subscription
    const subscriptionResponse = await fetch(`${apiBase}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "PayPal-Request-Id": `subscription-${user.id}-${Date.now()}`,
      },
      body: JSON.stringify({
        plan_id: planId,
        subscriber: {
          email_address: user.email,
        },
        application_context: {
          brand_name: "Hausto Premium",
          locale: "en-US",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          payment_method: {
            payer_selected: "PAYPAL",
            payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED",
          },
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      }),
    });

    const subscriptionData = await subscriptionResponse.json();
    if (!subscriptionResponse.ok) {
      throw new Error(`PayPal subscription creation failed: ${JSON.stringify(subscriptionData)}`);
    }

    logStep("PayPal subscription created", { subscriptionId: subscriptionData.id });

    // Find approval URL
    const approvalUrl = subscriptionData.links?.find((link: any) => link.rel === "approve")?.href;
    if (!approvalUrl) {
      throw new Error("No approval URL found in PayPal response");
    }

    return new Response(JSON.stringify({ 
      subscriptionId: subscriptionData.id,
      approvalUrl: approvalUrl 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-paypal-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});