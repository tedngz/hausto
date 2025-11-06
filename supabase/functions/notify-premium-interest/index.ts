import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  userEmail: string;
  userName: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Request received, checking authorization...");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header found");
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError) {
      console.error("Auth error:", authError);
      return new Response(JSON.stringify({ error: "Authentication failed", details: authError.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!user) {
      console.error("No user found after auth check");
      return new Response(JSON.stringify({ error: "Unauthorized - no user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("User authenticated:", user.id);

    const { userEmail, userName }: NotificationRequest = await req.json();

    console.log("Sending premium interest notifications for:", userEmail);

    // Send email to the renter
    const renterEmailResponse = await resend.emails.send({
      from: "Hausto <admin@hausto.com>",
      to: [userEmail],
      subject: "Premium Subscription Request Received",
      html: `
        <h1>Thank you for your interest in Hausto Premium!</h1>
        <p>Hi ${userName},</p>
        <p>We've received your request to upgrade to our Premium plan.</p>
        <p>You will receive a payment request email from Payoneer soon with instructions on how to complete your subscription.</p>
        <p>If you have any questions, please don't hesitate to contact us.</p>
        <p>Best regards,<br>The Hausto Team</p>
      `,
    });

    console.log("Renter email sent:", renterEmailResponse);

    // Send email to the admin
    const adminEmailResponse = await resend.emails.send({
      from: "Hausto <admin@hausto.com>",
      to: ["ted.ngz@gmail.com"],
      subject: "New Premium Subscription Interest",
      html: `
        <h1>New Premium Subscription Request</h1>
        <p>A user has expressed interest in subscribing to Premium:</p>
        <ul>
          <li><strong>Name:</strong> ${userName}</li>
          <li><strong>Email:</strong> ${userEmail}</li>
          <li><strong>User ID:</strong> ${user.id}</li>
        </ul>
        <p>Please send them a Payoneer payment request for the Premium subscription.</p>
      `,
    });

    console.log("Admin email sent:", adminEmailResponse);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Notifications sent successfully",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  } catch (error: any) {
    console.error("Error in notify-premium-interest function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
