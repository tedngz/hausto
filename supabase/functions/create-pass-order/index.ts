import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Opens the Polar checkout session for a Hausto Pass ($25, 30 days) or a
// viewing top-up ($10, 2 more coordination). One function for both because the
// flow is identical - only the product, the copy and the eligibility check
// differ.
//
// A top-up is refused without a live pass: its credits would lapse the moment
// they were bought, which is a charge for nothing.
//
// Price lives on the Polar product, not here. Polar is the merchant of record,
// so the amount it charges (plus whatever tax it collects) is the one that
// matters; restating it in this file would only create a second number to drift.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Kind = 'pass' | 'topup';

// Which Polar product each kind maps to. Set per environment so sandbox and
// production can point at their own products.
const PRODUCT_ENV_VAR: Record<Kind, string> = {
  pass: "POLAR_PRODUCT_PASS_ID",
  topup: "POLAR_PRODUCT_TOPUP_ID",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PASS-ORDER] ${step}${detailsStr}`);
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
    if (!user?.email) throw new Error("User not authenticated or email not available");

    const body = await req.json().catch(() => ({}));
    const kind: Kind = body?.kind === 'topup' ? 'topup' : 'pass';
    logStep("User authenticated", { userId: user.id, kind });

    const productId = Deno.env.get(PRODUCT_ENV_VAR[kind]);
    if (!productId) {
      throw new Error(`${PRODUCT_ENV_VAR[kind]} is not configured`);
    }

    if (kind === 'topup') {
      const { data: hasPass, error: passError } = await supabaseClient
        .rpc('has_active_pass', { _user_id: user.id });
      if (passError) throw passError;
      if (!hasPass) {
        return new Response(
          JSON.stringify({ error: "A top-up needs a live Hausto Pass - its credits expire with the pass." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
      }
    }

    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/$/, '') || '';
    // Polar substitutes {CHECKOUT_ID} at redirect time; /pass-success reads it
    // back and asks capture-pass-order to confirm the session.
    const successUrl = `${origin}/pass-success?checkout_id={CHECKOUT_ID}`;

    const checkoutResponse = await fetch(`${apiBase}/v1/checkouts/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        products: [productId],
        success_url: successUrl,
        customer_email: user.email,
        // Ties the Polar customer to the Supabase user, so a repeat buyer is
        // recognised and a refund can be traced back to an account.
        external_customer_id: user.id,
        // Set here and read back from Polar's API on capture - never from the
        // client - so what was bought is decided server-side on both ends.
        metadata: { kind, renter_id: user.id },
      }),
    });
    const checkout = await checkoutResponse.json();
    if (!checkoutResponse.ok) {
      throw new Error(`Polar checkout creation failed: ${JSON.stringify(checkout)}`);
    }
    if (!checkout?.url) {
      throw new Error("No checkout URL found in Polar response");
    }
    logStep("Polar checkout created", { checkoutId: checkout.id, kind });

    return new Response(JSON.stringify({ checkoutId: checkout.id, checkoutUrl: checkout.url, kind }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-pass-order", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
