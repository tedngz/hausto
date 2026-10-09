import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadLockIn, planPassCover } from "../_shared/viewing/lock-in-run.ts";
import { recordDigestOptIn } from "../_shared/viewing/account-link.ts";

// Opens the Polar checkout session for a Hausto Pass ($25, 30 days).
//
// Since the pricing rework (SPEC §9) the Pass covers every confirmed viewing
// for 30 days, and the $10 top-up for two more viewings is retired: a request
// for one is refused, and the product is archived in Polar by hand.
//
// Bought from the lock-in page, the checkout carries the request it is for
// (`requestRef`). It is refused once the plan's deadline has passed, and the
// checkout is written to the request's log, so the deadline waits for a
// renter who started paying in time rather than cancel under them. The plan
// is locked in where the purchase is recorded (_shared/polar-pass.ts).
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

    if (kind === 'topup') {
      return new Response(
        JSON.stringify({ error: "The top-up is retired - the Hausto Pass now covers every confirmed viewing." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // A Pass bought to lock in a plan: only while that plan is still open.
    const requestRef = typeof body?.requestRef === 'string' ? body.requestRef.trim().toUpperCase() : '';
    const lockInFor = requestRef ? await loadLockIn(supabaseClient, { ref: requestRef }, Date.now()) : null;
    if (requestRef) {
      if (!lockInFor || lockInFor.userId !== user.id) {
        return new Response(
          JSON.stringify({ error: `We could not find ${requestRef} on this account.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 },
        );
      }
      if (lockInFor.status !== 'OPEN') {
        return new Response(
          JSON.stringify({ error: "This plan can no longer be locked in.", status: lockInFor.status }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }
      if (await planPassCover(supabaseClient, lockInFor)) {
        return new Response(
          JSON.stringify({ error: "Your Pass already covers this plan - lock it in on its page." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }
    }

    // The digest's consent, ticked on our page before Polar's checkout - never
    // assumed from buying. Recorded now: it is consent whether or not the
    // payment completes, and the digest only reaches Pass holders anyway.
    if (body?.digestOptIn === true) {
      await recordDigestOptIn(supabaseClient, user.id, new Date());
      logStep("Digest opt-in recorded", { userId: user.id });
    }

    const productId = Deno.env.get(PRODUCT_ENV_VAR[kind]);
    if (!productId) {
      throw new Error(`${PRODUCT_ENV_VAR[kind]} is not configured`);
    }

    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/$/, '') || '';
    // Polar substitutes {CHECKOUT_ID} at redirect time; /pass-success reads it
    // back and asks capture-pass-order to confirm the session.
    const successUrl = `${origin}/pass-success?checkout_id={CHECKOUT_ID}${lockInFor ? `&ref=${lockInFor.ref}` : ''}`;

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
        metadata: { kind, renter_id: user.id, ...(lockInFor ? { request_id: lockInFor.requestId } : {}) },
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

    // Logged before the renter is sent to pay, or not at all: a checkout the
    // log does not know about cannot hold the deadline, and a payment that
    // lands after it would buy a Pass and keep no plan.
    if (lockInFor) {
      const expiresAt = typeof checkout.expires_at === 'string'
        ? checkout.expires_at
        : new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { error: evErr } = await supabaseClient.from('events').insert({
        request_id: lockInFor.requestId,
        type: 'LOCK_IN_CHECKOUT_OPENED',
        payload: { checkout_id: checkout.id, expires_at: expiresAt },
        actor: 'RENTER',
      });
      if (evErr) throw new Error(`Could not hold the plan for checkout: ${evErr.message}`);
    }

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
