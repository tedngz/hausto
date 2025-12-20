import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[EXPIRE-SUBSCRIPTIONS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Find all subscriptions where:
    // - subscribed is true
    // - subscription_end has passed
    // - No active PayPal subscription (already cancelled or manual)
    const now = new Date().toISOString();
    
    const { data: expiredSubscriptions, error: fetchError } = await supabaseClient
      .from("subscribers")
      .select("id, email, user_id, subscription_end, paypal_subscription_id")
      .eq("subscribed", true)
      .lt("subscription_end", now);

    if (fetchError) {
      throw new Error(`Failed to fetch expired subscriptions: ${fetchError.message}`);
    }

    logStep("Found expired subscriptions", { count: expiredSubscriptions?.length || 0 });

    if (!expiredSubscriptions || expiredSubscriptions.length === 0) {
      return new Response(JSON.stringify({ 
        message: "No expired subscriptions to process",
        processed: 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Update all expired subscriptions to free tier
    const { error: updateError, count } = await supabaseClient
      .from("subscribers")
      .update({
        subscribed: false,
        subscription_tier: "free",
        updated_at: now,
      })
      .eq("subscribed", true)
      .lt("subscription_end", now);

    if (updateError) {
      throw new Error(`Failed to update expired subscriptions: ${updateError.message}`);
    }

    logStep("Updated expired subscriptions", { 
      count,
      emails: expiredSubscriptions.map(s => s.email)
    });

    return new Response(JSON.stringify({ 
      message: "Successfully expired subscriptions",
      processed: expiredSubscriptions.length,
      emails: expiredSubscriptions.map(s => s.email)
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      error: "Failed to process expired subscriptions",
      details: errorMessage
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
