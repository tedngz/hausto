import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { recordPolarPurchase } from "../_shared/polar-pass.ts";
import { buildLinkDeepLink, hasLinkedNumber, linkCodeFor } from "../_shared/viewing/account-link.ts";

// Confirms a Polar checkout when the renter lands back on /pass-success.
//
// Polar takes the money itself, so this reads the session back rather than
// capturing anything: the payment already happened, and the only question is
// whether Polar says it succeeded.
//
// This is no longer the only path that records a purchase - handle-polar-webhooks
// does the same job from order.paid, for the renter who never makes it back to
// the site. Both share _shared/polar-pass.ts and key on the checkout id, so
// whichever runs first writes the row and the other reports it. What this one
// adds is the signed-in renter, whose claim on the checkout is checked, and the
// answer the success page renders.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Polar moves a session through `confirmed` before `succeeded`. Someone is
// watching a spinner here, so wait a few seconds rather than telling a renter
// who has just paid that it failed.
const CONFIRM_ATTEMPTS = 4;

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

    const result = await recordPolarPurchase({
      supabase: supabaseClient,
      apiBase,
      accessToken,
      checkoutId,
      expectedRenterId: user.id,
      attempts: CONFIRM_ATTEMPTS,
      log: logStep,
    });

    if (result.status === 'pending') {
      // Nothing is recorded yet, and nothing is lost: the renter can reload the
      // success page, and the webhook will record it regardless.
      return new Response(
        JSON.stringify({ pending: true, status: result.checkoutStatus }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    }

    // An account with no WhatsApp number has nobody to send its viewings or
    // its new places to, so the success page offers to link one.
    let whatsappLink: string | null = null;
    if (result.kind === 'pass' && !(await hasLinkedNumber(supabaseClient, user.id))) {
      const code = await linkCodeFor(supabaseClient, user.id, new Date());
      whatsappLink = buildLinkDeepLink(Deno.env.get('WHATSAPP_BUSINESS_PHONE') || '+84000000000', code);
    }

    return new Response(
      JSON.stringify({
        success: true,
        whatsappLink,
        kind: result.kind,
        viewings: result.viewings,
        expiresAt: result.expiresAt,
        alreadyCaptured: result.status === 'already',
        // The plan this Pass was bought to lock in, if any (SPEC §9).
        lockIn: result.lockIn
          ? { ref: result.lockIn.ref, lockedIn: result.lockIn.result.ok }
          : null,
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
