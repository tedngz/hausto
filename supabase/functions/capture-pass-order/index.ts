import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Captures an approved Hausto Pass or top-up order and records it.
//
// What was bought is decided from the amount PayPal reports as captured, never
// from the request body: a client-supplied kind would let someone pay $10 and
// claim a $25 pass. Idempotent via the unique paypal_order_id on passes.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PASS_DAYS = 30;
const PASS_VIEWINGS = 3;
const TOPUP_VIEWINGS = 2;

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CAPTURE-PASS-ORDER] ${step}${detailsStr}`);
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
      .from("passes")
      .select("id, kind, viewings_included, expires_at")
      .eq("paypal_order_id", orderId)
      .maybeSingle();
    if (existing) {
      logStep("Order already captured", { passId: existing.id });
      return new Response(
        JSON.stringify({
          success: true,
          kind: existing.kind,
          viewings: existing.viewings_included,
          expiresAt: existing.expires_at,
          alreadyCaptured: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

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
    // and fall through to recording the purchase.
    const alreadyCaptured = captureResponse.status === 422 &&
      captureData?.details?.some((d: { issue?: string }) => d.issue === "ORDER_ALREADY_CAPTURED");
    if (!captureResponse.ok && !alreadyCaptured) {
      throw new Error(`PayPal capture failed: ${JSON.stringify(captureData)}`);
    }
    if (!alreadyCaptured && captureData.status !== "COMPLETED") {
      throw new Error(`Unexpected capture status: ${captureData.status}`);
    }

    const unit = captureData?.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];

    // Verify the order belongs to this user (custom_id set at creation)
    const customId = capture?.custom_id ?? unit?.custom_id;
    if (customId && customId !== user.id) {
      throw new Error("Order does not belong to this user");
    }

    // The amount is the only trustworthy statement of what was bought.
    const amount = Number(capture?.amount?.value ?? unit?.amount?.value ?? NaN);
    if (!Number.isFinite(amount)) {
      throw new Error("Could not read the captured amount from PayPal");
    }
    let kind: 'pass' | 'topup';
    if (amount >= 25) kind = 'pass';
    else if (amount >= 10) kind = 'topup';
    else throw new Error(`Unrecognised amount captured: ${amount}`);

    // Both kinds hang off whatever cover is already live.
    const { data: passExpiry, error: expiryError } = await supabaseClient
      .rpc('active_pass_expires_at', { _user_id: user.id });
    if (expiryError) throw expiryError;

    let expiresAt: string;
    if (kind === 'pass') {
      // A pass bought while one is live extends it rather than overlapping it:
      // 30 days is what was paid for, so buying early must not burn the days
      // still left on the current pass.
      const from = passExpiry ? new Date(passExpiry as string).getTime() : Date.now();
      expiresAt = new Date(from + PASS_DAYS * 24 * 60 * 60 * 1000).toISOString();
    } else {
      // A top-up lapses with the pass that allowed it, so it never extends
      // cover on its own. Without a live pass there's nothing to attach it to -
      // except a complimentary pass, which is live but has no end date, so its
      // top-up gets its own 30-day window rather than failing after payment.
      if (passExpiry) {
        expiresAt = new Date(passExpiry as string).toISOString();
      } else {
        const { data: complimentary, error: complimentaryError } = await supabaseClient
          .rpc('has_complimentary_pass', { _user_id: user.id });
        if (complimentaryError) throw complimentaryError;
        if (!complimentary) {
          throw new Error("No live pass to attach this top-up to");
        }
        expiresAt = new Date(Date.now() + PASS_DAYS * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    // One row per purchase - the window is extended via expires_at above, so this
    // is always an insert, never an upsert onto an existing pass.
    const { error: insertError } = await supabaseClient.from("passes").insert({
      renter_id: user.id,
      kind,
      paypal_order_id: orderId,
      amount_usd: amount,
      viewings_included: kind === 'pass' ? PASS_VIEWINGS : TOPUP_VIEWINGS,
      expires_at: expiresAt,
    });
    // Unique-violation on paypal_order_id means a concurrent invoke won; fine.
    if (insertError && !String(insertError.message).includes("duplicate")) {
      throw insertError;
    }
    logStep("Purchase recorded", { userId: user.id, kind, expiresAt });

    return new Response(
      JSON.stringify({
        success: true,
        kind,
        viewings: kind === 'pass' ? PASS_VIEWINGS : TOPUP_VIEWINGS,
        expiresAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in capture-pass-order", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
