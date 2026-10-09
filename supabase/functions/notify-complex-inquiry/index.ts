import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";
import {
  ADMIN_EMAIL,
  CONCIERGE_FROM,
  corsHeaders,
  conversationHeaders,
  esc,
  inqToken,
  json,
  replyAddress,
  subjectToken,
  textToHtml,
} from "../_shared/concierge-email.ts";
import { formatVnd } from "../_shared/viewing/format.ts";
import { windowClosesAt } from "../_shared/viewing/inquiry.ts";
import { REPLY_WITHIN_HOURS, placeOf, replyWithinText } from "../_shared/viewing/place.ts";

// Tells the concierge about an availability request on WhatsApp (SPEC §11).
//
// Two notices, both to the admin only - the renter already has our WhatsApp
// confirmation:
//
//   * A new request, sent when the renter's code arrives (the webhook calls
//     this then). Not at the form: until the code arrives there is nobody to
//     reply to. notified_at makes it idempotent, so a replayed id cannot spam
//     the inbox, and a request whose code never came is refused as pending.
//   * `WHATSAPP_REPLY`, the "💬 replied" notice for a renter's WhatsApp message
//     on the thread. Service role only - it mails on every call, so an id
//     alone must not be able to trigger it.
//
// Both carry the tokenised Reply-To, so hitting Reply in Gmail lands in
// concierge-email-inbound, which relays it to the renter's WhatsApp.
//
// Email requests are retired. The old ones were notified when they were made;
// this does not mail about them again.

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const hcmcTime = (d: Date) =>
  d.toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

// deno-lint-ignore no-explicit-any
function windowNote(inquiry: any): string {
  const closes = windowClosesAt(inquiry.last_inbound_at ?? inquiry.whatsapp_confirmed_at);
  if (!closes) return "";
  return closes.getTime() > Date.now()
    ? `Their WhatsApp window is open until <strong>${esc(hcmcTime(closes))}</strong> (HCMC). After that WhatsApp only
       lets us send approved templates, so reply before then.`
    : `Their WhatsApp window closed at ${esc(hcmcTime(closes))} (HCMC). A reply cannot reach them until they write
       to us again.`;
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
        "id, complex_id, area_district_codes, area_label, user_id, full_name, phone, target_move_in_date, lease_duration_months, budget_max_vnd, bedrooms_needed, has_pets, additional_notes, notified_at, channel, whatsapp_confirmed_at, last_inbound_at",
      )
      .eq("id", inquiryId)
      .maybeSingle();

    if (error) throw error;
    if (!inquiry) return json({ error: "Inquiry not found" }, 404);
    if (inquiry.channel !== "WHATSAPP") {
      return json({ success: true, skipped: "email requests are retired" });
    }

    // A building, or an area (Priority search), which has no complex row.
    const place = await placeOf(supabase, inquiry);
    const complex = place ? { slug: place.slug, district: place.district } : null;
    const complexName = place?.name ?? "Unknown complex";

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
    if (!inquiry.whatsapp_confirmed_at) {
      // The form was filled in but the code never arrived. Nobody to reply to.
      return json({ success: true, pending: true });
    }
    if (inquiry.notified_at) {
      console.log("Inquiry already notified:", inquiryId);
      return json({ success: true, alreadyNotified: true });
    }

    const complexUrl = complex?.slug ? `https://hausto.com/complexes/${complex.slug}` : null;
    const bedrooms = Number(inquiry.bedrooms_needed) >= 4 ? "4+" : String(inquiry.bedrooms_needed);
    const budget = inquiry.budget_max_vnd != null ? `up to ${formatVnd(Number(inquiry.budget_max_vnd))}/mo` : "not given";

    // Reply-To is the thread alias only, never the renter: a Gmail reply must
    // come back to us so it can be relayed from the Hausto number. Anything else
    // would send the admin's personal address out.
    const adminEmail = await resend.emails.send({
      from: CONCIERGE_FROM,
      to: [ADMIN_EMAIL],
      reply_to: replyAddress(inquiry.id),
      subject: `🏢 Availability request: ${complexName}${subjectToken(inquiry.id)}`,
      // Opens the conversation that every later "💬 … replied" notice joins.
      headers: conversationHeaders(inqToken(inquiry.id)),
      html: `
        <h1>New concierge availability request</h1>
        <p>A renter asked the concierge to ${place?.kind === "AREA" ? `run an area search (${replyWithinText(REPLY_WITHIN_HOURS.AREA)}) in` : "check live availability at"}
        <strong>${esc(complexName)}</strong>${complex?.district ? ` (${esc(complex.district)})` : ""}.</p>

        <h2>Renter</h2>
        <ul>
          <li><strong>Name:</strong> ${esc(inquiry.full_name)}</li>
          <li><strong>WhatsApp:</strong> ${esc(inquiry.phone) || "-"}</li>
          <li><strong>Account:</strong> ${inquiry.user_id ? esc(inquiry.user_id) : "not signed in"}</li>
        </ul>

        <h2>What they need</h2>
        <ul>
          <li><strong>Move-in:</strong> ${esc(inquiry.target_move_in_date)}</li>
          <li><strong>Lease:</strong> ${esc(inquiry.lease_duration_months)} months</li>
          <li><strong>Bedrooms:</strong> ${esc(bedrooms)}</li>
          <li><strong>Budget:</strong> ${esc(budget)}</li>
          <li><strong>Pets:</strong> ${inquiry.has_pets ? "Yes" : "No"}</li>
          ${inquiry.additional_notes ? `<li><strong>Notes:</strong> ${esc(inquiry.additional_notes)}</li>` : ""}
        </ul>

        ${complexUrl ? `<p><a href="${esc(complexUrl)}">View ${esc(complexName)} →</a></p>` : ""}
        <p><a href="https://hausto.com/admin-tools">Open the concierge queue in Admin Tools →</a></p>

        <p style="margin-top: 20px; padding: 15px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
          <strong>Just hit Reply</strong> to answer ${esc(inquiry.full_name)} - your words go to their WhatsApp
          from the Hausto number, and the reply shows up on this request in Admin Tools. We told them a person
          would reply within ${replyWithinText(REPLY_WITHIN_HOURS[place?.kind ?? "BUILDING"])}. ${windowNote(inquiry)}
        </p>
      `,
    });
    console.log("Admin email sent:", adminEmail);

    await supabase.from("complex_inquiries").update({ notified_at: new Date().toISOString() }).eq("id", inquiry.id);
    return json({ success: true });
  } catch (error: unknown) {
    console.error("Error in notify-complex-inquiry function:", error);
    return json({ error: (error as Error).message }, 500);
  }
};

serve(handler);
