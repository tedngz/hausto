import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FastTrackNotificationRequest {
  renterName: string;
  renterEmail: string;
  preferredDates: string[];
  preferredTimes: string[];
  specialRequirements?: string;
  propertyTitles: string[];
  conversationId: string;
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

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Authentication failed", details: authError.message }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!user) {
      console.error("No user found after auth check");
      return new Response(JSON.stringify({ error: "Unauthorized - no user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("User authenticated:", user.id);

    const {
      renterName,
      renterEmail,
      preferredDates,
      preferredTimes,
      specialRequirements,
      propertyTitles,
      conversationId,
    }: FastTrackNotificationRequest = await req.json();

    console.log("Sending fast track request notifications for:", renterEmail);

    // Format dates and times for email
    const datesText = preferredDates.join(", ");
    const timesText = preferredTimes.join(", ");
    const propertiesText = propertyTitles.length > 0 
      ? `<ul>${propertyTitles.map(title => `<li>${title}</li>`).join("")}</ul>`
      : "<p>No specific properties listed</p>";

    // Send email to the Hausto Agent (admin)
    const adminEmailResponse = await resend.emails.send({
      from: "Hausto <hello@hausto.com>",
      to: ["ted.ngz@gmail.com"],
      subject: "🎯 New Fast Track Viewing Request",
      html: `
        <h1>New Fast Track Viewing Request</h1>
        <p>A renter has submitted a fast track viewing request that needs coordination:</p>
        
        <h2>Renter Information:</h2>
        <ul>
          <li><strong>Name:</strong> ${renterName}</li>
          <li><strong>Email:</strong> ${renterEmail}</li>
          <li><strong>User ID:</strong> ${user.id}</li>
        </ul>
        
        <h2>Viewing Preferences:</h2>
        <ul>
          <li><strong>Preferred Dates:</strong> ${datesText}</li>
          <li><strong>Preferred Times:</strong> ${timesText}</li>
          ${specialRequirements ? `<li><strong>Special Requirements:</strong> ${specialRequirements}</li>` : ''}
        </ul>
        
        <h2>Properties of Interest:</h2>
        ${propertiesText}
        
        <p><strong>Conversation ID:</strong> ${conversationId}</p>
        
        <p style="margin-top: 20px; padding: 15px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
          <strong>Action Required:</strong> Please coordinate with up to 3 listing providers and schedule viewings based on the renter's preferences.
        </p>
      `,
    });

    console.log("Admin email sent:", adminEmailResponse);

    // Send confirmation email to the renter
    const renterEmailResponse = await resend.emails.send({
      from: "Hausto <hello@hausto.com>",
      to: [renterEmail],
      subject: "Fast Track Request Received - Hausto",
      html: `
        <h1>Your Fast Track Request Has Been Received!</h1>
        <p>Hi ${renterName},</p>
        <p>We've received your fast track viewing request and Hausto Agent is now working on coordinating viewings with the listing providers.</p>
        
        <h2>Your Request Details:</h2>
        <ul>
          <li><strong>Preferred Dates:</strong> ${datesText}</li>
          <li><strong>Preferred Times:</strong> ${timesText}</li>
          ${specialRequirements ? `<li><strong>Special Requirements:</strong> ${specialRequirements}</li>` : ''}
        </ul>
        
        <h2>Properties Included:</h2>
        ${propertiesText}
        
        <p>We'll coordinate with up to 3 listing providers and get back to you with confirmed viewing details as soon as possible - typically within 24-48 hours.</p>
        
        <p>You can continue to chat with Hausto Agent in your conversation for any questions or updates.</p>
        
        <p>Best regards,<br>The Hausto Team</p>
      `,
    });

    console.log("Renter email sent:", renterEmailResponse);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Fast track notifications sent successfully",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-fast-track-request function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
