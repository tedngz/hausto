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
  inquiryIdFromText,
  json,
  replyAddress,
  stripQuotedReply,
  subjectToken,
  textToHtml,
} from "../_shared/concierge-email.ts";

// Receives mail sent to hello@hausto.com and files it onto the matching
// availability request, then pings ted.ngz@gmail.com so nothing sits unseen.
//
// Payload shapes accepted (whichever provider ends up in front of the domain):
//   - Resend inbound webhook          { type: "email.received", data: {...} }
//   - Amazon SES -> SNS notification  { Type: "Notification", Message: "{...}" }
//   - plain JSON                      { from, to, subject, text }
//
// Runs without a JWT because mail providers cannot mint one. Two ways in, so
// the provider in front of the domain can be swapped without a window where
// mail is dropped:
//   - RESEND_WEBHOOK_SECRET + Svix signature headers (Resend's own scheme)
//   - CONCIERGE_INBOUND_SECRET as ?secret= or x-webhook-secret
// A request carrying neither is refused.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const resend = new Resend(RESEND_API_KEY);
// Reading a received email's body needs a full-access key: Resend only grants
// "sending" or "full", and the sending key 401s on /emails/receiving with
// restricted_api_key. Held separately so the key every other function uses can
// stay send-only.
const RESEND_RECEIVING_KEY = Deno.env.get("RESEND_RECEIVING_API_KEY") ?? RESEND_API_KEY;
const INBOUND_SECRET = Deno.env.get("CONCIERGE_INBOUND_SECRET");
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");

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

/**
 * Resend signs webhooks the Svix way: HMAC-SHA256 over "<id>.<timestamp>.<body>"
 * keyed by the part of whsec_… after the prefix, base64-decoded. Several
 * signatures can be listed while a secret is being rotated, so any match passes.
 */
async function svixSignatureValid(req: Request, raw: string): Promise<boolean> {
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signatures = req.headers.get("svix-signature");
  if (!WEBHOOK_SECRET || !id || !timestamp || !signatures) return false;

  // Reject replays of an old capture; five minutes is Svix's own tolerance.
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) return false;

  const secret = WEBHOOK_SECRET.replace(/^whsec_/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return signatures.split(" ").some((entry) => entry.split(",")[1] === expected);
}

/**
 * Resend's email.received webhook carries metadata only - the body has to be
 * fetched. Returns null on failure so the caller can still file the message
 * (subject and sender alone are worth surfacing) rather than losing it.
 */
async function fetchReceivedEmail(emailId: string): Promise<any | null> {
  if (!RESEND_RECEIVING_KEY) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${RESEND_RECEIVING_KEY}` },
    });
    if (!res.ok) {
      console.error("Resend receiving fetch failed:", res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error("Resend receiving fetch threw:", error);
    return null;
  }
}

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

async function parsePayload(payload: any): Promise<ParsedMail | null> {
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

  // Resend inbound webhook. The email.received event is metadata only, so the
  // body comes from a follow-up call; anything already inlined (the plain-JSON
  // shape, or a future payload that carries a body) is used as-is.
  let data = payload?.data ?? payload;
  if (!data) return null;
  let fetchFailed = false;
  if (payload?.type === "email.received" && data.email_id && !data.text && !data.html) {
    const full = await fetchReceivedEmail(String(data.email_id));
    if (full) data = { ...data, ...(full.data ?? full) };
    else fetchFailed = true;
  }

  const text = data.text ?? (data.html ? String(data.html).replace(/<[^>]+>/g, " ") : "");
  // Say which of the two it was. "(empty message)" for a failed fetch reads as
  // "they sent nothing", and sends you looking in the wrong place.
  const fallback = fetchFailed
    ? `(could not read the body from Resend - the message is at https://resend.com/emails/${data.email_id})`
    : "(empty message)";
  return {
    from: bareAddress(data.from?.email ?? data.from),
    // received_for is the envelope recipient - the only place a plus-addressed
    // thread alias shows up when the header To: is the plain inbox.
    recipients: [...asList(data.to), ...asList(data.cc), ...asList(data.received_for)],
    subject: data.subject ?? "(no subject)",
    body: text || fallback,
    messageId: data.message_id ?? data.messageId ?? headerValue(data.headers, "message-id"),
    inReplyTo: data.in_reply_to ?? headerValue(data.headers, "in-reply-to"),
  };
}

/**
 * The Resend SDK reports a rejection in the result instead of throwing, so a
 * plain await looks like success. Throwing here pushes the failure up to the
 * 500 handler, which is what makes the provider retry rather than count the
 * message as delivered and drop it.
 */
async function sendMail(payload: Record<string, unknown>) {
  const result: any = await resend.emails.send(payload as any);
  if (result?.error) {
    throw new Error(`Resend rejected the message: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result;
}

/** Last resort for mail we could not file: a raw dump beats silence. */
async function alertAdmin(subject: string, note: string, body: string) {
  await sendMail({
    from: CONCIERGE_FROM,
    to: [ADMIN_EMAIL],
    subject,
    html: `<p>${esc(note)}</p>
           <p>It is not on any dashboard thread, so this copy is the only record.</p>
           <hr><pre style="white-space: pre-wrap; font-size: 12px;">${esc(body.slice(0, 5000))}</pre>`,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Read the body as text first: the Svix signature is over the exact bytes,
    // so re-serialising the parsed JSON would not verify.
    const raw = await req.text();

    const url = new URL(req.url);
    const provided = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
    const sharedSecretOk = !!INBOUND_SECRET && provided === INBOUND_SECRET;
    if (!sharedSecretOk && !(await svixSignatureValid(req, raw))) {
      console.warn("Rejected inbound mail: no valid signature or secret");
      return json({ error: "Forbidden" }, 403);
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      await alertAdmin("📥 Unreadable inbound webhook", "The request body was not JSON.", raw);
      return json({ success: true, matched: false, reason: "not_json" });
    }

    // SNS asks us to confirm the subscription by fetching a URL it supplies.
    // We deliberately do not follow URLs that arrive in a request body - the
    // link is logged so it can be confirmed from the AWS console instead.
    if (payload?.Type === "SubscriptionConfirmation") {
      console.log("SNS SubscriptionConfirmation received. Confirm in the AWS console:", payload.SubscribeURL);
      return json({ success: true, action: "confirm_subscription_manually" });
    }

    const mail = await parsePayload(payload);
    if (!mail || !mail.from) {
      // Somebody's mail arrived in a shape we do not read. Forward the payload
      // rather than returning a quiet 200 - a dropped message looks identical
      // to no message at all from the outside.
      console.warn("Unrecognised inbound payload");
      await alertAdmin(
        `📥 Unrecognised mail to ${CONCIERGE_INBOX}`,
        "An inbound webhook arrived in a shape this function does not parse.",
        raw,
      );
      return json({ success: true, matched: false, reason: "unparsable" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Prefer the inquiry id embedded in the plus address, then the copy in the
    // subject for the case where the provider did not keep the alias. A token
    // that no longer resolves (deleted request, mangled address) falls back to
    // the most recent request from that sender rather than dropping the mail.
    const tokenId = inquiryIdFromAddresses(mail.recipients) ?? inquiryIdFromText(mail.subject);
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
      // Our own notifications are sent from hello@hausto.com. One arriving back
      // here with nothing to file it against means a loop, and forwarding it
      // would keep the loop running - so that single case is dropped instead.
      if (mail.from === CONCIERGE_INBOX) {
        console.warn("Dropping unmatched mail from our own inbox to avoid a loop:", mail.subject);
        return json({ success: true, matched: false, reason: "self" });
      }

      // Everything else gets forwarded - a real person emailed us and would
      // otherwise hear nothing back. This is the path a cold email takes, and
      // the one that carries confirmation codes for the Gmail send-as setup.
      console.warn("Inbound mail matched no inquiry:", mail.from);
      await sendMail({
        from: CONCIERGE_FROM,
        to: [ADMIN_EMAIL],
        reply_to: [mail.from],
        subject: `📥 Unmatched mail to ${CONCIERGE_INBOX}: ${mail.subject}`,
        html: `<p><strong>From:</strong> ${esc(mail.from)}</p>
               <p>No availability request matches this sender, so it is not on any dashboard thread.
               Reply as <strong>${esc(CONCIERGE_INBOX)}</strong> and they never see your own address.</p>
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
    // though it arrived here as inbound mail. Only our own addresses may be
    // relayed onward as the concierge - anyone else who lands on the thread
    // alias is recorded and shown to the admin, never spoken for.
    const fromRenter = mail.from === bareAddress(inquiry.email);
    const fromHausto = !fromRenter && (mail.from === ADMIN_EMAIL || mail.from.endsWith("@hausto.com"));
    const direction = fromHausto ? "outbound" : "inbound";
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

    // 23505 = we already stored this message id. Carry on to the notification
    // rather than returning here: a redelivery is usually the provider retrying
    // a request we failed *after* the insert, and the thing that failed is
    // normally the notification itself. Stopping short would make the retry a
    // no-op and lose the alert for good. A second copy is the safer error.
    if (insertError && insertError.code !== "23505") throw insertError;
    const duplicate = !!insertError;
    if (duplicate) console.warn("Redelivery of a stored message; re-running the notification.");

    await supabase
      .from("complex_inquiries")
      .update({
        last_message_at: now,
        ...(fromHausto
          ? { status: inquiry.status === "closed" ? "closed" : "contacted", handled_at: inquiry.handled_at ?? now }
          : { last_inbound_at: now }),
      })
      .eq("id", inquiry.id);

    // The admin replied from Gmail. Relay their words to the renter as the
    // concierge so the renter never sees a personal address, and so the whole
    // conversation stays on one sender.
    if (fromHausto) {
      // The message row is already stored, so a 500 here would be retried into
      // the duplicate guard and never relayed. Report the failure to the admin
      // instead, while this request still ends as a success.
      let relayed = true;
      try {
        await sendMail({
          from: CONCIERGE_FROM,
          to: [inquiry.email],
          reply_to: CONCIERGE_FROM,
          // Never reuse the admin's subject line - it is our internal notification
          // ("💬 Hoang replied · City Garden"), which the renter should never see.
          subject: `Re: Availability at ${complex?.name ?? "your request"}`,
          html: `
            <p>Hi ${esc(inquiry.full_name)},</p>
            <div>${textToHtml(body)}</div>
            <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">
              Hausto Concierge · just reply to this email and we'll pick it up.
            </p>
          `,
        });
      } catch (relayError: any) {
        relayed = false;
        console.error("Failed to relay admin reply to renter:", relayError);
        await alertAdmin(
          `⚠️ Your reply to ${inquiry.full_name} did not go out`,
          `Relaying to ${inquiry.email} failed: ${relayError.message}. It is filed on the request in Admin Tools but the renter has not seen it.`,
          body,
        );
      }
      return json({ success: true, matched: true, inquiryId: inquiry.id, direction, relayed });
    }

    // Someone else's message - tell the admin. Reply-To is the thread alias
    // only, so their answer comes back through here rather than going straight
    // out from their personal mailbox.
    {
      await sendMail({
        from: CONCIERGE_FROM,
        to: [ADMIN_EMAIL],
        reply_to: replyAddress(inquiry.id),
        subject: `💬 ${fromRenter ? inquiry.full_name : mail.from} replied · ${
          complex?.name ?? "availability request"
        }${subjectToken(inquiry.id)}`,
        html: `
          <p><strong>${esc(fromRenter ? inquiry.full_name : mail.from)}</strong>
          (${esc(mail.from)}) replied about
          <strong>${esc(complex?.name ?? "their availability request")}</strong>.</p>
          <div style="border-left: 3px solid #e5e7eb; padding-left: 12px; margin: 16px 0;">
            ${textToHtml(body.slice(0, 5000))}
          </div>
          <p style="padding: 12px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
            <strong>Hit Reply</strong> to answer ${esc(inquiry.full_name)} - we send your words on from
            hello@hausto.com, so your own address stays private, and the reply lands on this request in
            <a href="https://hausto.com/admin-tools">Admin Tools</a>.
          </p>
        `,
      });
    }

    return json({ success: true, matched: true, inquiryId: inquiry.id, direction, duplicate });
  } catch (error: any) {
    console.error("Error in concierge-email-inbound:", error);
    return json({ error: error.message }, 500);
  }
});
