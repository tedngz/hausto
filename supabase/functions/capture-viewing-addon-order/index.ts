import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Captures an approved viewing-addon PayPal order and records the add-on:
// unlimited Fast-Track viewing bookings for 30 days. Idempotent via the
// unique paypal_order_id constraint on viewing_addons.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADDON_DAYS = 30;

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CAPTURE-VIEWING-ADDON-ORDER] ${step}${detailsStr}`);
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
    if (!user) throw new Error("User not authenticated");

    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");
    logStep("Capturing order", { orderId, userId: user.id });

    // Already recorded? (double-invoke, refresh of the success page)
    const { data: existing } = await supabaseClient
      .from("viewing_addons")
      .select("id, expires_at")
      .eq("paypal_order_id", orderId)
      .maybeSingle();
    if (existing) {
      logStep("Order already captured", { addonId: existing.id });
      return new Response(JSON.stringify({ success: true, expiresAt: existing.expires_at, alreadyCaptured: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

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

    const captureResponse = await fetch(`${apiBase}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
    });
    const captureData = await captureResponse.json();
    // ORDER_ALREADY_CAPTURED can happen on a re-invoke race; treat as success
    // and fall through to recording the add-on.
    const alreadyCaptured = captureResponse.status === 422 &&
      captureData?.details?.some((d: { issue?: string }) => d.issue === "ORDER_ALREADY_CAPTURED");
    if (!captureResponse.ok && !alreadyCaptured) {
      throw new Error(`PayPal capture failed: ${JSON.stringify(captureData)}`);
    }
    if (!alreadyCaptured && captureData.status !== "COMPLETED") {
      throw new Error(`Unexpected capture status: ${captureData.status}`);
    }

    // Verify the order belongs to this user (custom_id set at creation)
    const customId = captureData?.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id
      ?? captureData?.purchase_units?.[0]?.custom_id;
    if (customId && customId !== user.id) {
      throw new Error("Order does not belong to this user");
    }

    const expiresAt = new Date(Date.now() + ADDON_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await supabaseClient.from("viewing_addons").insert({
      renter_id: user.id,
      paypal_order_id: orderId,
      amount_usd: 20,
      expires_at: expiresAt,
    });
    // Unique-violation on paypal_order_id means a concurrent invoke won; fine.
    if (insertError && !String(insertError.message).includes("duplicate")) {
      throw insertError;
    }
    logStep("Add-on recorded", { userId: user.id, expiresAt });

    return new Response(JSON.stringify({ success: true, expiresAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in capture-viewing-addon-order", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
