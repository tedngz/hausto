import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Creates a $20 one-time PayPal order for the "unlimited viewings for a month"
// Fast-Track add-on. The renter approves on PayPal and is redirected to
// /addon-success, which invokes capture-viewing-addon-order.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADDON_PRICE_USD = "20.00";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-VIEWING-ADDON-ORDER] ${step}${detailsStr}`);
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
    const apiBase = Deno.env.get("PAYPAL_API_BASE") ?? "https://api-m.sandbox.paypal.com";

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
    logStep("User authenticated", { userId: user.id });

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
    const accessToken = authData.access_token;

    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/$/, '') || '';
    const returnUrl = `${origin}/addon-success`;
    const cancelUrl = `${origin}/discover`;

    const orderResponse = await fetch(`${apiBase}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "PayPal-Request-Id": `viewing-addon-${user.id}-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: "Hausto Fast-Track — unlimited viewing bookings for 30 days",
            custom_id: user.id,
            amount: { currency_code: "USD", value: ADDON_PRICE_USD },
          },
        ],
        application_context: {
          brand_name: "Hausto",
          locale: "en-US",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      }),
    });
    const orderData = await orderResponse.json();
    if (!orderResponse.ok) {
      throw new Error(`PayPal order creation failed: ${JSON.stringify(orderData)}`);
    }
    logStep("PayPal order created", { orderId: orderData.id });

    const approvalUrl = orderData.links?.find((link: { rel: string; href: string }) => link.rel === "approve")?.href;
    if (!approvalUrl) {
      throw new Error("No approval URL found in PayPal response");
    }

    return new Response(JSON.stringify({ orderId: orderData.id, approvalUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-viewing-addon-order", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
