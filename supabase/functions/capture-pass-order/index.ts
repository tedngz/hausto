import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Confirms a Polar checkout session and records what it bought.
//
// Polar takes the money itself, so this reads the session back rather than
// capturing anything: the payment already happened, and the only question is
// whether Polar says it succeeded. What was bought comes from the metadata this
// service set when it opened the session and reads back from Polar's API - never
// from the request body, which would let someone pay $10 and claim a $25 pass.
//
// Idempotent via the unique provider_order_id on passes.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PASS_DAYS = 30;
const PASS_VIEWINGS = 3;
const TOPUP_VIEWINGS = 2;

// Polar moves a session through `confirmed` (payment taken, order being
// written) before `succeeded`. The renter is already on the success page by
// then, so wait briefly rather than telling them it failed.
const CONFIRM_ATTEMPTS = 4;
const CONFIRM_DELAY_MS = 1000;

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

    const accessToken = Deno.env.get("POLAR_ACCESS_TOKEN");
    if (!accessToken) {
      throw new Error("Polar credentials not configured");
    }
    const apiBase = Deno.env.get("POLAR_API_BASE") ?? "https://sandbox-api.polar.sh";

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

    const { checkoutId } = await req.json();
    if (!checkoutId) throw new Error("checkoutId is required");
    logStep("Confirming checkout", { checkoutId, userId: user.id });

    // Already recorded? (double-invoke, refresh of the success page)
    const { data: existing } = await supabaseClient
      .from("passes")
      .select("id, kind, viewings_included, expires_at")
      .eq("provider_order_id", checkoutId)
      .maybeSingle();
    if (existing) {
      logStep("Checkout already recorded", { passId: existing.id });
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

    let checkout: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      const response = await fetch(`${apiBase}/v1/checkouts/${checkoutId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Polar checkout lookup failed: ${JSON.stringify(data)}`);
      }
      checkout = data;
      if (data.status === "succeeded") break;
      if (data.status === "expired" || data.status === "failed") {
        throw new Error(`Checkout did not complete: ${data.status}`);
      }
      // `open` or `confirmed` - still settling, so give it a moment.
      if (attempt < CONFIRM_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));
      }
    }

    if (checkout?.status !== "succeeded") {
      // Nothing is recorded yet, and nothing is lost: the renter can reload the
      // success page, which calls this again with the same checkout id.
      logStep("Checkout not settled yet", { checkoutId, status: checkout?.status });
      return new Response(
        JSON.stringify({ pending: true, status: checkout?.status ?? "unknown" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    }

    // The session belongs to whoever it was opened for.
    if (checkout.external_customer_id && checkout.external_customer_id !== user.id) {
      throw new Error("Checkout does not belong to this user");
    }

    // Set by create-pass-order, so this is our own statement of what was sold,
    // not the buyer's. Price is Polar's to set, so it is recorded rather than
    // used to infer the product - a price change in the dashboard must not
    // silently turn a pass into a top-up.
    const metadata = (checkout.metadata ?? {}) as Record<string, unknown>;
    const kind = metadata.kind as 'pass' | 'topup' | undefined;
    if (kind !== 'pass' && kind !== 'topup') {
      throw new Error(`Unrecognised checkout metadata kind: ${String(kind)}`);
    }
    if (metadata.renter_id && metadata.renter_id !== user.id) {
      throw new Error("Checkout does not belong to this user");
    }

    // Polar reports money in minor units. `amount` is the product price; the
    // tax it collects on top is Polar's to remit, not Hausto revenue.
    const amountUsd = Number(checkout.amount ?? NaN) / 100;
    if (!Number.isFinite(amountUsd)) {
      throw new Error("Could not read the amount from Polar");
    }

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
      provider: 'polar',
      provider_order_id: checkoutId,
      amount_usd: amountUsd,
      viewings_included: kind === 'pass' ? PASS_VIEWINGS : TOPUP_VIEWINGS,
      expires_at: expiresAt,
    });
    // Unique-violation on provider_order_id means a concurrent invoke won; fine.
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
