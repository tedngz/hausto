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

// Sends an admin's reply to a complex availability request from
// hello@hausto.com, threads it against the last message, logs it, and BCCs
// ted.ngz@gmail.com so the same conversation is readable in Gmail.
// Admin-only: the JWT is checked against has_role(uid, 'admin').

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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

    const { inquiryId, body } = await req.json();
    const message = String(body ?? "").trim();
    if (!inquiryId || !message) return json({ error: "inquiryId and body are required" }, 400);

    const { data: inquiry } = await supabase
      .from("complex_inquiries")
      .select("id, full_name, email, complex_id, status, handled_at")
      .eq("id", inquiryId)
      .maybeSingle();
    if (!inquiry) return json({ error: "Inquiry not found" }, 404);

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
