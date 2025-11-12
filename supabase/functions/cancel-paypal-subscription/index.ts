import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CANCEL-PAYPAL-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const payPalConfigured = Boolean(clientId && clientSecret);
    if (!payPalConfigured) {
      logStep("PayPal credentials not configured - proceeding with local cancellation only");
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
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Get subscriber record
    const { data: subscriberData, error: subscriberError } = await supabaseClient
      .from("subscribers")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (subscriberError || !subscriberData) {
      throw new Error("No subscription record found");
    }

    // Check if user has premium status
    if (!subscriberData.subscribed && subscriberData.subscription_tier === "free") {
      throw new Error("No active subscription to cancel");
    }

    const hasPayPalSubscription = Boolean(subscriberData.paypal_subscription_id);
    logStep("Subscription status", { 
      hasPayPalId: hasPayPalSubscription, 
      tier: subscriberData.subscription_tier,
      subscribed: subscriberData.subscribed 
    });

    // Get PayPal access token
    let accessToken: string | null = null;
    if (payPalConfigured) {
      try {
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
          logStep("PayPal auth failed", { error: authData.error_description || authData.error || "Unknown" });
        } else {
          accessToken = authData.access_token;
          logStep("Obtained PayPal access token");
        }
      } catch (authErr) {
        logStep("PayPal auth exception", { error: authErr instanceof Error ? authErr.message : String(authErr) });
      }
    } else {
      logStep("Skipping PayPal auth - credentials missing");
    }

    // Cancel PayPal subscription (only if PayPal subscription exists)
    let paypalCancelled = false;
    if (accessToken && hasPayPalSubscription) {
      try {
        const cancelResponse = await fetch(
          `https://api.sandbox.paypal.com/v1/billing/subscriptions/${subscriberData.paypal_subscription_id}/cancel`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              reason: "User requested cancellation",
            }),
          }
        );
    
        if (!cancelResponse.ok) {
          const errorData = await cancelResponse.json();
          logStep("PayPal cancellation failed", { status: cancelResponse.status, error: errorData });
          // Don't throw here - we'll still update our database
        } else {
          paypalCancelled = true;
          logStep("PayPal subscription cancelled successfully");
        }
      } catch (paypalError) {
        logStep("PayPal API error", { error: paypalError instanceof Error ? paypalError.message : String(paypalError) });
        // Continue with database update even if PayPal fails
      }
    } else {
      if (!hasPayPalSubscription) {
        logStep("Skipping PayPal cancellation - no PayPal subscription ID (manual premium grant)");
      } else {
        logStep("Skipping PayPal cancellation - no PayPal access token available");
      }
    }

    // Update subscriber record in our database
    const { error: updateError } = await supabaseClient.from("subscribers").update({
      subscribed: false,
      subscription_tier: "free",
      subscription_end: null,
      paypal_subscription_id: null, // Clear the PayPal ID
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id);

    if (updateError) {
      logStep("Database update failed", { error: updateError.message });
      throw new Error(`Failed to update subscription status: ${updateError.message}`);
    }

    logStep("Subscription cancelled successfully", { paypalCancelled });

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Subscription cancelled successfully",
      paypalCancelled 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in cancel-paypal-subscription", { message: errorMessage });
    
    // Provide more specific error message for debugging
    return new Response(JSON.stringify({ 
      error: "Unable to cancel subscription", 
      details: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});