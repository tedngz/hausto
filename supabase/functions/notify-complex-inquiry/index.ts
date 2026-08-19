import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";
import {
  ADMIN_EMAIL,
  CONCIERGE_FROM,
  corsHeaders,
  conversationHeaders,
  esc,
  firstName,
  inqToken,
  json,
  replyAddress,
  signature,
  subjectToken,
} from "../_shared/concierge-email.ts";

// Emails the concierge team when a renter asks us to check live availability at
// a complex. Anonymous visitors can submit the form, so this runs without a
// JWT: the caller only passes the inquiry id it just inserted, and everything
// mailed out is read back server-side with the service role. notified_at makes
// the send idempotent so a replayed id cannot be used to spam the inbox.
//
// The renter replies to plain hello@hausto.com; the admin copy uses the
// tokenised alias. Either way the reply lands in concierge-email-inbound and is
// filed onto the thread the admin dashboard shows.

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { inquiryId } = await req.json();
    if (!inquiryId || typeof inquiryId !== "string") {
      return json({ error: "inquiryId is required" }, 400);
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
    if (!inquiry) return json({ error: "Inquiry not found" }, 404);

    if (inquiry.notified_at) {
      console.log("Inquiry already notified:", inquiryId);
      return json({ success: true, alreadyNotified: true });
    }

    const { data: complex } = await supabase
      .from("complexes")
      .select("name, slug, district, city")
      .eq("id", inquiry.complex_id)
      .maybeSingle();

    const complexName = complex?.name ?? "Unknown complex";
    const complexUrl = complex?.slug ? `https://hausto.com/complexes/${complex.slug}` : null;
    const budget = `$${inquiry.budget_usd_min.toLocaleString()} – $${inquiry.budget_usd_max.toLocaleString()}/mo`;
    // The renter replies to the plain concierge address; the admin's copy gets
    // the tokenised one so a Gmail reply can still be tied back to this request.
    const adminThreadAddress = replyAddress(inquiry.id);
    const subject = `Availability at ${complexName}`;

    const criteriaHtml = `
        <ul>
          <li><strong>Move-in:</strong> ${esc(inquiry.target_move_in_date)}</li>
          <li><strong>Lease:</strong> ${esc(inquiry.lease_duration_months)} months</li>
          <li><strong>Bedrooms:</strong> ${esc(inquiry.bedrooms_needed)}</li>
          <li><strong>Budget:</strong> ${esc(budget)}</li>
          <li><strong>Pets:</strong> ${inquiry.has_pets ? "Yes" : "No"}</li>
          ${inquiry.additional_notes ? `<li><strong>Notes:</strong> ${esc(inquiry.additional_notes)}</li>` : ""}
        </ul>`;

    // Admin copy. Reply-To is the thread alias only, never the renter: a Gmail
    // reply must come back to us so we can relay it from hello@hausto.com.
    // Putting the renter here would expose the admin's personal address.
    const adminEmail = await resend.emails.send({
      from: CONCIERGE_FROM,
      to: [ADMIN_EMAIL],
      reply_to: adminThreadAddress,
      subject: `🏢 Availability request: ${complexName}${subjectToken(inquiry.id)}`,
      // Opens the conversation that every later "💬 … replied" notice joins.
      headers: conversationHeaders(inqToken(inquiry.id)),
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
        ${criteriaHtml}

        ${complexUrl ? `<p><a href="${esc(complexUrl)}">View ${esc(complexName)} →</a></p>` : ""}
        <p><a href="https://hausto.com/admin-tools">Open the concierge queue in Admin Tools →</a></p>

        <p style="margin-top: 20px; padding: 15px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
          <strong>Just hit Reply</strong> to answer ${esc(inquiry.full_name)} — we send your words on
          from hello@hausto.com, so your own address stays private, and the reply shows up on this
          request in Admin Tools.
        </p>
      `,
    });
    console.log("Admin email sent:", adminEmail);

    const renterEmail = await resend.emails.send({
      from: CONCIERGE_FROM,
      to: [inquiry.email],
      reply_to: CONCIERGE_FROM,
      subject: `We're checking ${subject.toLowerCase()}`,
      html: `
        <h1>Your availability request is in</h1>
        <p>Hi ${esc(firstName(inquiry.full_name))},</p>
        <p>We're checking live availability at <strong>${esc(complexName)}</strong>
        and will come back to you within 24 hours with vetted units.</p>

        <h2>What we're matching against</h2>
        ${criteriaHtml}

        <p>Anything to add? Just reply to this email.</p>
        ${signature()}
      `,
    });
    console.log("Renter email sent:", renterEmail);

    const now = new Date().toISOString();

    // Seed the thread with the renter's own request so the dashboard shows the
    // full conversation from the top. Both rows must set created_at: a bulk
    // insert sends one unified column list, so a key missing from any row is
    // written as NULL rather than falling back to the column default.
    const { error: threadError } = await supabase.from("complex_inquiry_messages").insert([
      {
        inquiry_id: inquiry.id,
        direction: "inbound",
        source: "system",
        from_email: inquiry.email,
        to_emails: ["hello@hausto.com"],
        subject: `Availability request: ${complexName}`,
        body: [
          `Submitted the availability form for ${complexName}.`,
          `Move-in ${inquiry.target_move_in_date} · ${inquiry.lease_duration_months}-month lease`,
          `${inquiry.bedrooms_needed} bedroom(s) · ${budget} · pets: ${inquiry.has_pets ? "yes" : "no"}`,
          inquiry.additional_notes ? `Notes: ${inquiry.additional_notes}` : "",
        ].filter(Boolean).join("\n"),
        created_at: inquiry.created_at ?? now,
      },
      {
        inquiry_id: inquiry.id,
        direction: "outbound",
        source: "system",
        from_email: "hello@hausto.com",
        to_emails: [inquiry.email],
        subject: `We're checking ${subject.toLowerCase()}`,
        body: "Automatic confirmation sent: the concierge is checking availability and will reply within 24 hours.",
        provider_message_id: (renterEmail as any)?.data?.id ?? null,
        created_at: now,
      },
    ]);

    // The mail is already out, so a thread-logging failure must not fail the
    // request - but it must be visible rather than swallowed.
    if (threadError) console.error("Failed to seed inquiry thread:", threadError);

    await supabase
      .from("complex_inquiries")
      .update({ notified_at: now, last_message_at: now, last_inbound_at: inquiry.created_at ?? now })
      .eq("id", inquiry.id);

    return json({ success: true, threadLogged: !threadError, threadError: threadError?.message ?? null });
  } catch (error: any) {
    console.error("Error in notify-complex-inquiry function:", error);
    return json({ error: error.message }, 500);
  }
};

serve(handler);
