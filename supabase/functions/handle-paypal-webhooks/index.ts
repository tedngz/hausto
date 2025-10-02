import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  // Only log non-sensitive information
  const safeDetails = details ? { 
    eventType: details.eventType, 
    resourceId: details.resourceId?.substring(0, 8) + '...',
    status: details.status 
  } : '';
  console.log(`[HANDLE-PAYPAL-WEBHOOKS] ${step}${safeDetails ? ` - ${JSON.stringify(safeDetails)}` : ''}`);
};

// Verify PayPal webhook signature using PayPal's verification API
const verifyWebhookSignature = async (body: string, headers: Headers): Promise<boolean> => {
  try {
    const paypalWebhookId = headers.get('PAYPAL-TRANSMISSION-ID');
    const paypalCertId = headers.get('PAYPAL-CERT-ID');
    const paypalAuthAlgo = headers.get('PAYPAL-AUTH-ALGO');
    const paypalTransmissionSig = headers.get('PAYPAL-TRANSMISSION-SIG');
    const paypalTransmissionTime = headers.get('PAYPAL-TRANSMISSION-TIME');
    
    // Validate all required headers are present
    if (!paypalWebhookId || !paypalCertId || !paypalAuthAlgo || !paypalTransmissionSig || !paypalTransmissionTime) {
      logStep("Missing required PayPal headers");
      return false;
    }

    // Get PayPal webhook ID from environment
    const webhookId = Deno.env.get('PAYPAL_WEBHOOK_ID');
    if (!webhookId) {
      logStep("PAYPAL_WEBHOOK_ID not configured");
      return false;
    }

    // Call PayPal's webhook verification API
    const paypalClientId = Deno.env.get('PAYPAL_CLIENT_ID');
    const paypalClientSecret = Deno.env.get('PAYPAL_CLIENT_SECRET');
    const isProduction = Deno.env.get('PAYPAL_MODE') === 'production';
    const baseUrl = isProduction ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

    // Get access token
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${paypalClientId}:${paypalClientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenResponse.ok) {
      logStep("Failed to get PayPal access token");
      return false;
    }

    const { access_token } = await tokenResponse.json();

    // Verify webhook signature
    const verifyResponse = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        transmission_id: paypalWebhookId,
        transmission_time: paypalTransmissionTime,
        cert_url: paypalCertId,
        auth_algo: paypalAuthAlgo,
        transmission_sig: paypalTransmissionSig,
        webhook_id: webhookId,
        webhook_event: JSON.parse(body),
      }),
    });

    if (!verifyResponse.ok) {
      logStep("PayPal signature verification failed");
      return false;
    }

    const verifyResult = await verifyResponse.json();
    return verifyResult.verification_status === 'SUCCESS';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logStep("Webhook signature verification error", { error: errorMessage });
    return false;
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Webhook received");
    
    // Verify this is a legitimate PayPal webhook
    const rawBody = await req.text();
    const isValidWebhook = await verifyWebhookSignature(rawBody, req.headers);
    
    if (!isValidWebhook) {
      logStep("Invalid webhook signature");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = JSON.parse(rawBody);
    const eventType = body.event_type;
    const resource = body.resource;
    
    logStep("Processing webhook event", { eventType, resourceId: resource?.id });

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.RENEWED': {
        const subscriptionId = resource.id;
        const subscriberEmail = resource.subscriber?.email_address;
        
        if (!subscriberEmail || !subscriptionId) {
          logStep("Missing required subscription data");
          break;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(subscriberEmail)) {
          logStep("Invalid email format");
          break;
        }

        // First, check if user exists in auth.users to prevent unauthorized updates
        const { data: userExists } = await supabaseClient
          .from('profiles')
          .select('id')
          .eq('email', subscriberEmail)
          .single();

        if (!userExists) {
          logStep("User not found in system", { email: subscriberEmail.substring(0, 5) + '...' });
          break;
        }

        // Update subscription status to active - only for existing users
        const { error: upsertError } = await supabaseClient.from("subscribers").upsert({
          user_id: userExists.id,
          email: subscriberEmail,
          paypal_subscription_id: subscriptionId,
          subscribed: true,
          subscription_tier: "premium",
          subscription_end: resource.billing_info?.next_billing_time || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });

        if (upsertError) {
          logStep("Failed to update subscription", { error: upsertError.message });
        }
        
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
    logStep("ERROR in handle-paypal-webhooks", { message: "Webhook processing failed" });
    
    // Don't expose internal error details for security
    return new Response(JSON.stringify({ error: "Internal error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});