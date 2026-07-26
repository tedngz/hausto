import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

// Emails the concierge team when a renter asks us to check live availability at a
// complex. Anonymous visitors can submit the form, so this runs without a JWT:
// the caller only passes the inquiry id it just inserted, and everything mailed
// out is read back server-side with the service role. notified_at makes the send
// idempotent so a replayed id cannot be used to spam the inbox.

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const ADMIN_EMAIL = "ted.ngz@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { inquiryId } = await req.json();
    if (!inquiryId || typeof inquiryId !== "string") {
      return new Response(JSON.stringify({ error: "inquiryId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: inquiry, error } = await supabase
      .from("complex_inquiries")
      .select(
        "id, complex_id, user_id, full_name, email, phone, target_move_in_date, lease_duration_months, budget_usd_min, budget_usd_max, bedrooms_needed, has_pets, additional_notes, notified_at, created_at",
      )
      .eq("id", inquiryId)
      .maybeSingle();

    if (error) throw error;
    if (!inquiry) {
      return new Response(JSON.stringify({ error: "Inquiry not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (inquiry.notified_at) {
      console.log("Inquiry already notified:", inquiryId);
      return new Response(JSON.stringify({ success: true, alreadyNotified: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: complex } = await supabase
      .from("complexes")
      .select("name, slug, district, city")
      .eq("id", inquiry.complex_id)
      .maybeSingle();

    const complexName = complex?.name ?? "Unknown complex";
    const complexUrl = complex?.slug ? `https://hausto.com/complexes/${complex.slug}` : null;
    const budget = `$${inquiry.budget_usd_min.toLocaleString()} – $${inquiry.budget_usd_max.toLocaleString()}/mo`;

    const adminEmail = await resend.emails.send({
      from: "Hausto <hello@hausto.com>",
      to: [ADMIN_EMAIL],
      replyTo: inquiry.email,
      subject: `🏢 Availability request: ${complexName}`,
      html: `
        <h1>New concierge availability request</h1>
        <p>A renter asked the concierge to check live availability at
        <strong>${esc(complexName)}</strong>${complex?.district ? ` (${esc(complex.district)})` : ""}.</p>

        <h2>Renter</h2>
        <ul>
          <li><strong>Name:</strong> ${esc(inquiry.full_name)}</li>
          <li><strong>Email:</strong> <a href="mailto:${esc(inquiry.email)}">${esc(inquiry.email)}</a></li>
          <li><strong>Phone:</strong> ${esc(inquiry.phone) || "—"}</li>
          <li><strong>Account:</strong> ${inquiry.user_id ? esc(inquiry.user_id) : "not signed in"}</li>
        </ul>

        <h2>What they need</h2>
        <ul>
          <li><strong>Move-in:</strong> ${esc(inquiry.target_move_in_date)}</li>
          <li><strong>Lease:</strong> ${esc(inquiry.lease_duration_months)} months</li>
          <li><strong>Bedrooms:</strong> ${esc(inquiry.bedrooms_needed)}</li>
          <li><strong>Budget:</strong> ${esc(budget)}</li>
          <li><strong>Pets:</strong> ${inquiry.has_pets ? "Yes" : "No"}</li>
          ${inquiry.additional_notes ? `<li><strong>Notes:</strong> ${esc(inquiry.additional_notes)}</li>` : ""}
        </ul>

        ${complexUrl ? `<p><a href="${esc(complexUrl)}">View ${esc(complexName)} →</a></p>` : ""}
        <p><a href="https://hausto.com/admin-tools">Open the concierge queue in Admin Tools →</a></p>

        <p style="margin-top: 20px; padding: 15px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
          <strong>Action required:</strong> reply with vetted availability within 24 hours.
        </p>
      `,
    });
    console.log("Admin email sent:", adminEmail);

    const renterEmail = await resend.emails.send({
      from: "Hausto <hello@hausto.com>",
      to: [inquiry.email],
      subject: `We're checking availability at ${complexName}`,
      html: `
        <h1>Your availability request is in</h1>
        <p>Hi ${esc(inquiry.full_name)},</p>
        <p>Our concierge is checking live availability at <strong>${esc(complexName)}</strong>
        and will come back to you within 24 hours with vetted units.</p>

        <h2>What we're matching against</h2>
        <ul>
          <li><strong>Move-in:</strong> ${esc(inquiry.target_move_in_date)}</li>
          <li><strong>Lease:</strong> ${esc(inquiry.lease_duration_months)} months</li>
          <li><strong>Bedrooms:</strong> ${esc(inquiry.bedrooms_needed)}</li>
          <li><strong>Budget:</strong> ${esc(budget)}</li>
          <li><strong>Pets:</strong> ${inquiry.has_pets ? "Yes" : "No"}</li>
          ${inquiry.additional_notes ? `<li><strong>Your notes:</strong> ${esc(inquiry.additional_notes)}</li>` : ""}
        </ul>

        <p>Anything to add? Just reply to this email.</p>
        <p>Best regards,<br>The Hausto Team</p>
      `,
    });
    console.log("Renter email sent:", renterEmail);

    await supabase
      .from("complex_inquiries")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", inquiry.id);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in notify-complex-inquiry function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
