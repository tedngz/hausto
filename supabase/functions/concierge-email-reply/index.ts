import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";
import {
  ADMIN_EMAIL,
  CONCIERGE_FROM,
  corsHeaders,
  greeting,
  json,
  signature,
  textToHtml,
} from "../_shared/concierge-email.ts";
import { adapterFromEnv } from "../_shared/whatsapp/adapter.ts";
import { SupabaseMessageStore } from "../_shared/whatsapp/store.ts";
import { ConsecutiveMessageError, ServiceWindowClosedError } from "../_shared/whatsapp/send.ts";
import { NoWhatsAppError, recordInquiryMessage, sendConciergeWhatsApp } from "../_shared/viewing/concierge.ts";

// Sends an admin's reply to a complex availability request, by the request's
// channel (SPEC §11). WhatsApp - every new request: from the Hausto number,
// inside the window the renter's code opened, filed on the request's thread.
// Email - the requests made before email was retired: from hello@hausto.com,
// threaded against the last message, logged, and BCC'd to ted.ngz@gmail.com so
// the same conversation is readable in Gmail.
// Admin-only: the JWT is checked against has_role(uid, 'admin').

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

/**
 * The admin's words to a WhatsApp request's renter, filed on its thread.
 *
 * A closed window and the two-in-a-row rule come back as 409 with a message the
 * panel shows as it is: both are "not now", not failures, and the admin needs
 * to know which.
 */
// deno-lint-ignore no-explicit-any
async function replyOnWhatsApp(supabase: any, inquiry: any, message: string, key: string): Promise<Response> {
  let sent: { messageId: string; status: string };
  try {
    sent = await sendConciergeWhatsApp(supabase, new SupabaseMessageStore(supabase), adapterFromEnv(Deno.env.toObject()), {
      inquiryId: inquiry.id, body: message, key,
    });
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      return json({
        error: "window_closed",
        message: "Their WhatsApp window has closed. It reopens when they write to us.",
      }, 409);
    }
    if (e instanceof ConsecutiveMessageError) {
      return json({
        error: "too_many_consecutive",
        message: "They have not replied to your last two messages. Wait for them before sending another.",
      }, 409);
    }
    if (e instanceof NoWhatsAppError) {
      return json({ error: "not_confirmed", message: "They never sent us the WhatsApp code, so there is nobody to reply to." }, 409);
    }
    throw e;
  }
  if (sent.status === "FAILED") return json({ error: "send_failed", message: "WhatsApp refused the message." }, 502);

  const now = new Date();
  await recordInquiryMessage(supabase, {
    inquiryId: inquiry.id, direction: "outbound", source: "dashboard",
    whatsappMessageId: sent.messageId, body: message, now,
  });
  await supabase
    .from("complex_inquiries")
    .update({
      last_message_at: now.toISOString(),
      status: inquiry.status === "closed" ? "closed" : "contacted",
      handled_at: inquiry.handled_at ?? now.toISOString(),
    })
    .eq("id", inquiry.id);

  return json({ success: true, channel: "WHATSAPP" });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Admins only" }, 403);

    const { inquiryId, body, key } = await req.json();
    const message = String(body ?? "").trim();
    if (!inquiryId || !message) return json({ error: "inquiryId and body are required" }, 400);

    const { data: inquiry } = await supabase
      .from("complex_inquiries")
      .select("id, full_name, email, complex_id, status, handled_at, channel")
      .eq("id", inquiryId)
      .maybeSingle();
    if (!inquiry) return json({ error: "Inquiry not found" }, 404);

    // A WhatsApp request is answered on WhatsApp, and only there.
    if (inquiry.channel === "WHATSAPP") {
      return await replyOnWhatsApp(supabase, inquiry, message, String(key || crypto.randomUUID()));
    }
    if (!inquiry.email) return json({ error: "no_email", message: "This request has no email address." }, 400);

    const { data: complex } = await supabase
      .from("complexes")
      .select("name")
      .eq("id", inquiry.complex_id)
      .maybeSingle();

    // Thread against the renter's latest message so mail clients group it.
    const { data: lastInbound } = await supabase
      .from("complex_inquiry_messages")
      .select("provider_message_id, subject")
      .eq("inquiry_id", inquiry.id)
      .eq("direction", "inbound")
      .not("provider_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const complexName = complex?.name ?? "your availability request";
    const subject = lastInbound?.subject?.replace(/^(re:\s*)+/i, "") ?? `Availability at ${complexName}`;
    const headers: Record<string, string> = {};
    if (lastInbound?.provider_message_id) {
      headers["In-Reply-To"] = lastInbound.provider_message_id;
      headers["References"] = lastInbound.provider_message_id;
    }

    const sent = await resend.emails.send({
      from: CONCIERGE_FROM,
      to: [inquiry.email],
      bcc: [ADMIN_EMAIL],
      // Renters see the plain concierge address; their reply is matched back to
      // this request by sender address, not by a token in the recipient.
      reply_to: CONCIERGE_FROM,
      subject: `Re: ${subject}`,
      headers,
      html: `
        ${greeting(inquiry.full_name, message)}
        <div>${textToHtml(message)}</div>
        ${signature("Just reply to this email and we'll pick it up.")}
      `,
    });
    if ((sent as any)?.error) throw new Error((sent as any).error.message ?? "Resend rejected the message");

    const now = new Date().toISOString();

    await supabase.from("complex_inquiry_messages").insert({
      inquiry_id: inquiry.id,
      direction: "outbound",
      source: "dashboard",
      from_email: "hello@hausto.com",
      to_emails: [inquiry.email],
      subject: `Re: ${subject}`,
      body: message,
      provider_message_id: (sent as any)?.data?.id ?? null,
      in_reply_to: lastInbound?.provider_message_id ?? null,
    });

    await supabase
      .from("complex_inquiries")
      .update({
        last_message_at: now,
        status: inquiry.status === "closed" ? "closed" : "contacted",
        handled_at: inquiry.handled_at ?? now,
      })
      .eq("id", inquiry.id);

    return json({ success: true });
  } catch (error: any) {
    console.error("Error in concierge-email-reply:", error);
    return json({ error: error.message }, 500);
  }
});
