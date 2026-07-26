import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";
import {
  ADMIN_EMAIL,
  bareAddress,
  CONCIERGE_FROM,
  CONCIERGE_INBOX,
  corsHeaders,
  esc,
  inquiryIdFromAddresses,
  json,
  replyAddress,
  stripQuotedReply,
  textToHtml,
} from "../_shared/concierge-email.ts";

// Receives mail sent to hello@hausto.com and files it onto the matching
// availability request, then pings ted.ngz@gmail.com so nothing sits unseen.
//
// Payload shapes accepted (whichever provider ends up in front of the domain):
//   - Amazon SES -> SNS notification  { Type: "Notification", Message: "{...}" }
//   - Resend inbound webhook          { type: "email.received", data: {...} }
//   - plain JSON                      { from, to, subject, text }
//
// Runs without a JWT because mail providers cannot mint one. Set
// CONCIERGE_INBOUND_SECRET and pass it as ?secret= or x-webhook-secret to keep
// strangers from writing to the thread.

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const INBOUND_SECRET = Deno.env.get("CONCIERGE_INBOUND_SECRET");

interface ParsedMail {
  from: string;
  recipients: string[];
  subject: string;
  body: string;
  messageId: string | null;
  inReplyTo: string | null;
}

const headerValue = (headers: unknown, name: string): string | null => {
  const target = name.toLowerCase();
  if (Array.isArray(headers)) {
    const hit = headers.find((h: any) => String(h?.name ?? "").toLowerCase() === target);
    return hit ? String((hit as any).value ?? "") : null;
  }
  if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === target) return String(value ?? "");
    }
  }
  return null;
};

const asList = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => bareAddress(typeof v === "string" ? v : (v as any)?.address ?? ""));
  return String(value).split(",").map(bareAddress).filter(Boolean);
};

/** SES delivers the raw RFC822 message; pull the first text/plain part out. */
function textFromRawMime(raw: string): string {
  const boundary = raw.match(/boundary="?([^";\s]+)"?/i)?.[1];
  const decode = (part: string) => {
    const split = part.indexOf("\r\n\r\n") >= 0 ? part.indexOf("\r\n\r\n") + 4 : part.indexOf("\n\n") + 2;
    const headers = part.slice(0, split);
    let body = part.slice(split);
    if (/content-transfer-encoding:\s*base64/i.test(headers)) {
      try {
        body = new TextDecoder().decode(
          Uint8Array.from(atob(body.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
        );
      } catch { /* leave as-is */ }
    } else if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
      body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    return body;
  };

  if (boundary) {
    const parts = raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    if (plain) return decode(plain);
    const html = parts.find((p) => /content-type:\s*text\/html/i.test(p));
    if (html) return decode(html).replace(/<[^>]+>/g, " ");
  }
  return decode(raw);
}

function parsePayload(payload: any): ParsedMail | null {
  // Amazon SES via SNS
  if (payload?.Type === "Notification" && typeof payload.Message === "string") {
    let inner: any;
    try {
      inner = JSON.parse(payload.Message);
    } catch {
      return null;
    }
    const mail = inner?.mail ?? {};
    const headers = mail.headers ?? [];
    const raw = inner?.content ? String(inner.content) : "";
    const decodedRaw = raw && !raw.includes("\n") && /^[A-Za-z0-9+/=\s]+$/.test(raw)
      ? (() => {
        try {
          return new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)));
        } catch {
          return raw;
        }
      })()
      : raw;
    return {
      from: bareAddress(mail.source ?? headerValue(headers, "from")),
      recipients: [...asList(mail.destination), ...asList(inner?.receipt?.recipients)],
      subject: mail.commonHeaders?.subject ?? headerValue(headers, "subject") ?? "(no subject)",
      body: decodedRaw ? textFromRawMime(decodedRaw) : "(message body unavailable)",
      messageId: mail.messageId ? `<${mail.messageId}>` : headerValue(headers, "message-id"),
      inReplyTo: headerValue(headers, "in-reply-to"),
    };
  }

  // Resend inbound webhook
  const data = payload?.data ?? payload;
  if (!data) return null;
  const text = data.text ?? (data.html ? String(data.html).replace(/<[^>]+>/g, " ") : "");
  return {
    from: bareAddress(data.from?.email ?? data.from),
    recipients: [...asList(data.to), ...asList(data.cc)],
    subject: data.subject ?? "(no subject)",
    body: text || "(empty message)",
    messageId: data.message_id ?? data.messageId ?? headerValue(data.headers, "message-id"),
    inReplyTo: data.in_reply_to ?? headerValue(data.headers, "in-reply-to"),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (INBOUND_SECRET) {
      const url = new URL(req.url);
      const provided = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
      if (provided !== INBOUND_SECRET) {
        console.warn("Rejected inbound mail: bad secret");
        return json({ error: "Forbidden" }, 403);
      }
    }

    const payload = await req.json();

    // SNS asks us to confirm the subscription by fetching a URL it supplies.
    // We deliberately do not follow URLs that arrive in a request body - the
    // link is logged so it can be confirmed from the AWS console instead.
    if (payload?.Type === "SubscriptionConfirmation") {
      console.log("SNS SubscriptionConfirmation received. Confirm in the AWS console:", payload.SubscribeURL);
      return json({ success: true, action: "confirm_subscription_manually" });
    }

    const mail = parsePayload(payload);
    if (!mail || !mail.from) {
      console.warn("Unrecognised inbound payload");
      return json({ success: true, matched: false, reason: "unparsable" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Prefer the inquiry id embedded in the plus address. A token that no
    // longer resolves (deleted request, mangled address) falls back to the most
    // recent request from that sender rather than dropping the mail silently.
    const tokenId = inquiryIdFromAddresses(mail.recipients);
    let inquiry: { id: string; full_name: string; email: string; status: string; complex_id: string; handled_at: string | null } | null = null;

    if (tokenId) {
      const { data } = await supabase
        .from("complex_inquiries")
        .select("id, full_name, email, status, complex_id, handled_at")
        .eq("id", tokenId)
        .maybeSingle();
      inquiry = data ?? null;
    }
    // Renters reply to the plain concierge address, so their sender address is
    // normally the only handle we have. Prefer their newest still-open request:
    // a reply about a closed one almost always means they are chasing it again.
    if (!inquiry) {
      const { data } = await supabase
        .from("complex_inquiries")
        .select("id, full_name, email, status, complex_id, handled_at")
        .eq("email", mail.from)
        .order("created_at", { ascending: false })
        .limit(10);
      const rows = data ?? [];
      inquiry = rows.find((r) => r.status !== "closed") ?? rows[0] ?? null;
    }

    if (!inquiry) {
      // Still tell the admin - a real person emailed us and would otherwise
      // hear nothing back. 200 so the provider does not retry forever.
      console.warn("Inbound mail matched no inquiry:", mail.from);
      await resend.emails.send({
        from: CONCIERGE_FROM,
        to: [ADMIN_EMAIL],
        reply_to: [mail.from],
        subject: `📥 Unmatched mail to ${CONCIERGE_INBOX}: ${mail.subject}`,
        html: `<p><strong>From:</strong> ${esc(mail.from)}</p>
               <p>No availability request matches this sender, so it is not on any dashboard thread.</p>
               <hr><div>${textToHtml(mail.body.slice(0, 5000))}</div>`,
      });
      return json({ success: true, matched: false });
    }

    const { data: complex } = await supabase
      .from("complexes")
      .select("name")
      .eq("id", inquiry.complex_id)
      .maybeSingle();

    // A message from our own side (admin replying in Gmail) is outbound even
    // though it arrived here as inbound mail.
    const fromRenter = mail.from === bareAddress(inquiry.email);
    const direction = fromRenter ? "inbound" : "outbound";
    const body = stripQuotedReply(mail.body).slice(0, 20000) || "(empty message)";
    const now = new Date().toISOString();

    const { error: insertError } = await supabase.from("complex_inquiry_messages").insert({
      inquiry_id: inquiry.id,
      direction,
      source: "email",
      from_email: mail.from,
      to_emails: mail.recipients,
      subject: mail.subject,
      body,
      provider_message_id: mail.messageId,
      in_reply_to: mail.inReplyTo,
    });

    // 23505 = we already stored this message id; a duplicate delivery is a
    // success from the provider's point of view.
    if (insertError && insertError.code !== "23505") throw insertError;
    if (insertError) return json({ success: true, duplicate: true });

    await supabase
      .from("complex_inquiries")
      .update({
        last_message_at: now,
        ...(fromRenter ? { last_inbound_at: now } : {}),
        ...(fromRenter
          ? {}
          : { status: inquiry.status === "closed" ? "closed" : "contacted", handled_at: inquiry.handled_at ?? now }),
      })
      .eq("id", inquiry.id);

    // Only forward the renter's own words - forwarding the admin's Gmail reply
    // back to the admin would just be an echo.
    if (fromRenter) {
      await resend.emails.send({
        from: CONCIERGE_FROM,
        to: [ADMIN_EMAIL],
        reply_to: [inquiry.email, replyAddress(inquiry.id)],
        subject: `💬 ${inquiry.full_name} replied · ${complex?.name ?? "availability request"}`,
        html: `
          <p><strong>${esc(inquiry.full_name)}</strong> (${esc(inquiry.email)}) replied about
          <strong>${esc(complex?.name ?? "their availability request")}</strong>.</p>
          <div style="border-left: 3px solid #e5e7eb; padding-left: 12px; margin: 16px 0;">
            ${textToHtml(body.slice(0, 5000))}
          </div>
          <p style="padding: 12px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
            <strong>Hit Reply</strong> to answer them - your reply is copied to the concierge inbox
            and lands on this request in
            <a href="https://hausto.com/admin-tools">Admin Tools</a>.
          </p>
        `,
      });
    }

    return json({ success: true, matched: true, inquiryId: inquiry.id, direction });
  } catch (error: any) {
    console.error("Error in concierge-email-inbound:", error);
    return json({ error: error.message }, 500);
  }
});
