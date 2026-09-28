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
  textToHtml,
} from "../_shared/concierge-email.ts";
import { formatVnd } from "../_shared/viewing/format.ts";
import { windowClosesAt } from "../_shared/viewing/inquiry.ts";

// Tells the concierge team about an availability request (SPEC §11).
//
// Two kinds of request, told apart by `channel`:
//
//   * EMAIL - the original flow. Emails the admin and confirms to the renter,
//     then seeds the thread. Anonymous visitors can submit the form, so the
//     caller only passes the inquiry id and everything mailed out is read back
//     server-side; notified_at makes the send idempotent so a replayed id
//     cannot be used to spam the inbox.
//   * WHATSAPP - the renter answers on WhatsApp. Nothing is sent until the
//     renter has sent us the code (whatsapp_confirmed_at), because until then
//     there is nobody to reply to; the webhook calls this at that moment. The
//     renter already has our WhatsApp confirmation, so only the admin is mailed.
//
// And one event: `WHATSAPP_REPLY`, the "💬 replied" notice for a renter's
// WhatsApp message on the thread. Service role only - it mails the admin on
// every call, so the id alone must not be able to trigger it.
//
// Either way the admin's copy carries the tokenised Reply-To, so hitting Reply
// in Gmail lands in concierge-email-inbound, which relays it by the request's
// channel.

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const hcmcTime = (d: Date) =>
  d.toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

// deno-lint-ignore no-explicit-any
function budgetText(inquiry: any): string {
  if (inquiry.budget_max_vnd != null) return `up to ${formatVnd(Number(inquiry.budget_max_vnd))}/mo`;
  if (inquiry.budget_usd_min != null && inquiry.budget_usd_max != null) {
    return `$${Number(inquiry.budget_usd_min).toLocaleString()} - $${Number(inquiry.budget_usd_max).toLocaleString()}/mo`;
  }
  return "not given";
}

// deno-lint-ignore no-explicit-any
function bedroomsText(inquiry: any): string {
  return Number(inquiry.bedrooms_needed) >= 4 ? "4+" : String(inquiry.bedrooms_needed);
}

// deno-lint-ignore no-explicit-any
function windowNote(inquiry: any): string {
  const closes = windowClosesAt(inquiry.last_inbound_at ?? inquiry.whatsapp_confirmed_at);
  if (!closes) return "";
  return closes.getTime() > Date.now()
    ? `Their WhatsApp window is open until <strong>${esc(hcmcTime(closes))}</strong> (HCMC). After that WhatsApp only
       lets us send approved templates, so reply before then.`
    : `Their WhatsApp window closed at ${esc(hcmcTime(closes))} (HCMC). A reply cannot reach WhatsApp until they
       write to us again${inquiry.email ? ` - reply by email to ${esc(inquiry.email)} instead` : ""}.`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { inquiryId, event } = await req.json();
    if (!inquiryId || typeof inquiryId !== "string") {
      return json({ error: "inquiryId is required" }, 400);
    }

    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_ROLE);

    const { data: inquiry, error } = await supabase
      .from("complex_inquiries")
      .select(
        "id, complex_id, user_id, full_name, email, phone, target_move_in_date, lease_duration_months, budget_usd_min, budget_usd_max, budget_max_vnd, bedrooms_needed, has_pets, additional_notes, notified_at, created_at, channel, whatsapp_confirmed_at, last_inbound_at",
      )
      .eq("id", inquiryId)
      .maybeSingle();

    if (error) throw error;
    if (!inquiry) return json({ error: "Inquiry not found" }, 404);

    const { data: complex } = await supabase
      .from("complexes")
      .select("name, slug, district, city")
      .eq("id", inquiry.complex_id)
      .maybeSingle();
    const complexName = complex?.name ?? "Unknown complex";

    // ── A renter's WhatsApp reply ───────────────────────────────────────────
    if (event === "WHATSAPP_REPLY") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!SERVICE_ROLE || token !== SERVICE_ROLE) return json({ error: "Unauthorized" }, 401);

      const { data: last } = await supabase
        .from("complex_inquiry_messages")
        .select("body")
        .eq("inquiry_id", inquiry.id)
        .eq("direction", "inbound")
        .eq("channel", "WHATSAPP")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      await resend.emails.send({
        from: CONCIERGE_FROM,
        to: [ADMIN_EMAIL],
        reply_to: replyAddress(inquiry.id),
        subject: `💬 ${inquiry.full_name} replied on WhatsApp · ${complexName}${subjectToken(inquiry.id)}`,
        headers: conversationHeaders(inqToken(inquiry.id)),
        html: `
          <p><strong>${esc(inquiry.full_name)}</strong> replied on WhatsApp about
          <strong>${esc(complexName)}</strong>.</p>
          <div style="border-left: 3px solid #e5e7eb; padding-left: 12px; margin: 16px 0;">
            ${textToHtml(String(last?.body ?? "(no text - a photo, voice note or location)").slice(0, 5000))}
          </div>
          <p style="padding: 12px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
            <strong>Hit Reply</strong> to answer - your words go to their WhatsApp from the Hausto number, and land
            on this request in <a href="https://hausto.com/admin-tools">Admin Tools</a>. ${windowNote(inquiry)}
          </p>
        `,
      });
      return json({ success: true, event });
    }

    // ── A new request ───────────────────────────────────────────────────────
    const whatsapp = inquiry.channel === "WHATSAPP";
    if (whatsapp && !inquiry.whatsapp_confirmed_at) {
      // The form was filled in but the code never arrived. Nobody to reply to.
      return json({ success: true, pending: true });
    }

    if (inquiry.notified_at) {
      console.log("Inquiry already notified:", inquiryId);
      return json({ success: true, alreadyNotified: true });
    }

    const complexUrl = complex?.slug ? `https://hausto.com/complexes/${complex.slug}` : null;
    const budget = budgetText(inquiry);
    // The renter replies to the plain concierge address; the admin's copy gets
    // the tokenised one so a Gmail reply can still be tied back to this request.
    const adminThreadAddress = replyAddress(inquiry.id);
    const subject = `Availability at ${complexName}`;

    const criteriaHtml = `
        <ul>
          <li><strong>Move-in:</strong> ${esc(inquiry.target_move_in_date)}</li>
          <li><strong>Lease:</strong> ${esc(inquiry.lease_duration_months)} months</li>
          <li><strong>Bedrooms:</strong> ${esc(bedroomsText(inquiry))}</li>
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
      subject: `🏢 Availability request: ${complexName}${whatsapp ? " (WhatsApp)" : ""}${subjectToken(inquiry.id)}`,
      // Opens the conversation that every later "💬 … replied" notice joins.
      headers: conversationHeaders(inqToken(inquiry.id)),
      html: `
        <h1>New concierge availability request</h1>
        <p>A renter asked the concierge to check live availability at
        <strong>${esc(complexName)}</strong>${complex?.district ? ` (${esc(complex.district)})` : ""}.</p>

        <h2>Renter</h2>
        <ul>
          <li><strong>Name:</strong> ${esc(inquiry.full_name)}</li>
          <li><strong>Replies on:</strong> ${whatsapp ? "WhatsApp" : "email"}</li>
          ${whatsapp ? `<li><strong>WhatsApp:</strong> ${esc(inquiry.phone) || "-"}</li>` : ""}
          <li><strong>Email:</strong> ${
            inquiry.email ? `<a href="mailto:${esc(inquiry.email)}">${esc(inquiry.email)}</a>` : "-"
          }</li>
          ${!whatsapp ? `<li><strong>Phone:</strong> ${esc(inquiry.phone) || "-"}</li>` : ""}
          <li><strong>Account:</strong> ${inquiry.user_id ? esc(inquiry.user_id) : "not signed in"}</li>
        </ul>

        <h2>What they need</h2>
        ${criteriaHtml}

        ${complexUrl ? `<p><a href="${esc(complexUrl)}">View ${esc(complexName)} →</a></p>` : ""}
        <p><a href="https://hausto.com/admin-tools">Open the concierge queue in Admin Tools →</a></p>

        <p style="margin-top: 20px; padding: 15px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
          ${whatsapp
            ? `<strong>Just hit Reply</strong> to answer ${esc(inquiry.full_name)} - your words go to their WhatsApp
               from the Hausto number, and the reply shows up on this request in Admin Tools. We told them a person
               would reply within 24 hours. ${windowNote(inquiry)}`
            : `<strong>Just hit Reply</strong> to answer ${esc(inquiry.full_name)} - we send your words on
               from hello@hausto.com, so your own address stays private, and the reply shows up on this
               request in Admin Tools.`}
        </p>
      `,
    });
    console.log("Admin email sent:", adminEmail);

    const now = new Date().toISOString();

    if (whatsapp) {
      // The renter has our WhatsApp confirmation already, and their code
      // message opened the thread (routing.ts). Nothing else to send or seed.
      await supabase.from("complex_inquiries").update({ notified_at: now }).eq("id", inquiry.id);
      return json({ success: true, channel: "WHATSAPP" });
    }

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
          `${bedroomsText(inquiry)} bedroom(s) · ${budget} · pets: ${inquiry.has_pets ? "yes" : "no"}`,
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
        // deno-lint-ignore no-explicit-any
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
  } catch (error: unknown) {
    console.error("Error in notify-complex-inquiry function:", error);
    return json({ error: (error as Error).message }, 500);
  }
};

serve(handler);
