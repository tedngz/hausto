import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[HANDLE-PAYPAL-WEBHOOKS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Webhook received");
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    const eventType = body.event_type;
    const resource = body.resource;
    
    logStep("Processing webhook event", { eventType, resourceId: resource?.id });

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.RENEWED': {
        const subscriptionId = resource.id;
        const subscriberEmail = resource.subscriber?.email_address;
        
        if (!subscriberEmail) {
          logStep("No subscriber email found");
          break;
        }

        // Update subscription status to active
        await supabaseClient.from("subscribers").upsert({
          email: subscriberEmail,
          paypal_subscription_id: subscriptionId,
          subscribed: true,
          subscription_tier: "premium",
          subscription_end: resource.billing_info?.next_billing_time || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
        
        logStep("Subscription activated", { email: subscriberEmail, subscriptionId });
        break;
      }
      
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        const subscriptionId = resource.id;
        
        // Update subscription status to inactive
        const { error } = await supabaseClient
          .from("subscribers")
          .update({
            subscribed: false,
            subscription_tier: "free",
            subscription_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq("paypal_subscription_id", subscriptionId);
          
        if (error) {
          logStep("Error updating subscription", { error: error.message });
        } else {
          logStep("Subscription deactivated", { subscriptionId });
        }
        break;
      }
      
      default:
        logStep("Unhandled event type", { eventType });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in handle-paypal-webhooks", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});