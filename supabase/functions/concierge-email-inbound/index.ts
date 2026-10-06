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
  boxToken,
  conversationHeaders,
  greeting,
  inqToken,
  inquiryIdFromAddresses,
  inquiryIdFromText,
  json,
  mailThreadAddress,
  mailThreadIdFromText,
  mailThreadToken,
  messageIdCandidates,
  normalizeSubject,
  replyAddress,
  signature,
  stripQuotedReply,
  subjectToken,
  textToHtml,
} from "../_shared/concierge-email.ts";
import { adapterFromEnv } from "../_shared/whatsapp/adapter.ts";
import { SupabaseMessageStore } from "../_shared/whatsapp/store.ts";
import { ConsecutiveMessageError, ServiceWindowClosedError } from "../_shared/whatsapp/send.ts";
import { sendConciergeWhatsApp } from "../_shared/viewing/concierge.ts";
import { placeOf } from "../_shared/viewing/place.ts";

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
  references: string | null;
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
      references: headerValue(headers, "references"),
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
    references: data.references ?? headerValue(data.headers, "references"),
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

/** Our own side of the conversation: the admin, or anything at the domain. */
const fromUs = (address: string) => address === ADMIN_EMAIL || address.endsWith("@hausto.com");

/**
 * Mail that matches no availability request still needs somewhere to be
 * answered from. A row in concierge_mail_threads gives it an alias, so the
 * admin's reply comes back here to be relayed as the concierge instead of
 * leaving their personal address on a stranger's screen.
 */
async function handleStandaloneMail(
  supabase: any,
  mail: ParsedMail,
  senderInquiries: number,
): Promise<Response> {
  const body = stripQuotedReply(mail.body).slice(0, 20000) || "(empty message)";
  const now = new Date().toISOString();
  const knownId = mailThreadIdFromText(...mail.recipients, mail.subject);

  let thread: { id: string; contact_email: string; contact_name: string | null; subject: string | null } | null = null;
  if (knownId) {
    const { data } = await supabase
      .from("concierge_mail_threads")
      .select("id, contact_email, contact_name, subject")
      .eq("id", knownId)
      .maybeSingle();
    thread = data ?? null;
  }

  // The admin answering a cold email. Send it on as the concierge, under the
  // contact's own subject - never ours, which is the internal notification
  // ("📥 Unmatched mail to hello@hausto.com: GM") and would be quoted straight
  // back at them along with everything it says about their record.
  if (thread && fromUs(mail.from)) {
    await sendMail({
      from: CONCIERGE_FROM,
      to: [thread.contact_email],
      reply_to: CONCIERGE_FROM,
      subject: `Re: ${String(thread.subject ?? "your message").replace(/^((re|fwd?)\s*:\s*)+/i, "")}`,
      html: `
        ${greeting(thread.contact_name, body)}
        <div>${textToHtml(body)}</div>
        ${signature("Just reply to this email and we'll pick it up.")}
      `,
    });
    await supabase
      .from("concierge_mail_threads")
      .update({ last_message_at: now, status: "answered" })
      .eq("id", thread.id);
    console.log("Relayed admin reply on standalone thread", thread.id);
    return json({ success: true, matched: true, threadId: thread.id, direction: "outbound", relayed: true });
  }

  // Our own notifications go out from hello@hausto.com. One arriving back with
  // no alias to route it by means a loop, and answering it would keep the loop
  // running - so that single case is dropped rather than replied to. A message
  // that does carry an alias is handled above: that is the admin writing as the
  // concierge from Gmail, which is a real reply and must go on.
  if (mail.from === CONCIERGE_INBOX) {
    console.warn("Dropping unroutable mail from our own inbox to avoid a loop:", mail.subject);
    return json({ success: true, matched: false, reason: "self" });
  }

  // Admin mail carrying no alias - a reply whose subject was edited, or a
  // forward. There is no contact to send it to, so say so rather than bouncing
  // it back as though a stranger had written in.
  if (fromUs(mail.from)) {
    await alertAdmin(
      "⚠️ Could not route your reply",
      "This came from you but carries no thread alias, so there is nobody to send it on to. Reply to the original notification instead of composing a new message.",
      body,
    );
    return json({ success: true, matched: false, reason: "unroutable_admin_mail" });
  }

  // Someone writing in. Reuse the thread for this conversation if they already
  // have one, so a back-and-forth stays on a single row.
  if (!thread) {
    const subjectKey = normalizeSubject(mail.subject) || "(no subject)";
    const { data: existing } = await supabase
      .from("concierge_mail_threads")
      .select("id, contact_email, contact_name, subject")
      .eq("contact_email", mail.from)
      .eq("subject_key", subjectKey)
      .maybeSingle();
    thread = existing ?? null;

    if (!thread) {
      const { data: created, error } = await supabase
        .from("concierge_mail_threads")
        .insert({
          contact_email: mail.from,
          subject: mail.subject,
          subject_key: subjectKey,
          last_message_at: now,
        })
        .select("id, contact_email, contact_name, subject")
        .single();
      if (error) throw error;
      thread = created;
    } else {
      await supabase
        .from("concierge_mail_threads")
        .update({ last_message_at: now, status: "open" })
        .eq("id", thread.id);
    }
  }

  const context = senderInquiries
    ? `<p>This sender has ${senderInquiries} availability request${senderInquiries > 1 ? "s" : ""} on file,
       but nothing on them matches this subject, so it has been kept off those threads rather than
       answered inside one about a different building.</p>`
    : "";

  // The thread's own subject, never the incoming one. Echoing "Re: GMGN" back
  // produced a second Gmail conversation next to the first, because the two
  // subjects differ by a "Re:" that is not at the front and so is not stripped.
  const threadSubject = String(thread!.subject ?? "(no subject)")
    .replace(/^((re|fwd?)\s*:\s*)+/i, "");

  await sendMail({
    from: CONCIERGE_FROM,
    to: [ADMIN_EMAIL],
    reply_to: mailThreadAddress(thread!.id),
    subject: `📥 ${thread!.contact_email}: ${threadSubject}${mailThreadToken(thread!.id)}`,
    headers: conversationHeaders(boxToken(thread!.id)),
    html: `
      <p><strong>From:</strong> ${esc(mail.from)}</p>
      ${context}
      <div style="border-left: 3px solid #e5e7eb; padding-left: 12px; margin: 16px 0;">
        ${textToHtml(body.slice(0, 5000))}
      </div>
      <p style="padding: 12px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
        <strong>Hit Reply</strong> - it comes back to us and goes out from ${esc(CONCIERGE_INBOX)},
        so your own address stays private and their answer lands here too.
      </p>
    `,
  });

  return json({ success: true, matched: false, threadId: thread!.id });
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
    let inquiry: { id: string; full_name: string; email: string | null; status: string; complex_id: string | null; area_district_codes: string[] | null; area_label: string | null; handled_at: string | null; channel: string } | null = null;

    if (tokenId) {
      const { data } = await supabase
        .from("complex_inquiries")
        .select("id, full_name, email, status, complex_id, area_district_codes, area_label, handled_at, channel")
        .eq("id", tokenId)
        .maybeSingle();
      inquiry = data ?? null;
    }
    // A genuine reply quotes the message it answers. Match on that before
    // anything to do with the sender.
    if (!inquiry) {
      const refs = messageIdCandidates(mail.inReplyTo, mail.references);
      if (refs.length) {
        const { data } = await supabase
          .from("complex_inquiry_messages")
          .select("inquiry_id")
          .in("provider_message_id", refs)
          .limit(1)
          .maybeSingle();
        if (data?.inquiry_id) {
          const { data: row } = await supabase
            .from("complex_inquiries")
            .select("id, full_name, email, status, complex_id, area_district_codes, area_label, handled_at, channel")
            .eq("id", data.inquiry_id)
            .maybeSingle();
          inquiry = row ?? null;
        }
      }
    }

    // Renters reply to the plain concierge address, so their sender address is
    // often the only handle we have - but the address alone is not enough. A
    // renter who writes to us about something new would otherwise be stapled
    // onto whatever request they last had open, and the answer would arrive
    // inside a thread about a different building. Require the subject to match
    // one already on the thread before joining it on sender alone.
    let senderInquiries: typeof inquiry[] = [];
    if (!inquiry) {
      const { data } = await supabase
        .from("complex_inquiries")
        .select("id, full_name, email, status, complex_id, area_district_codes, area_label, handled_at, channel")
        .eq("email", mail.from)
        .order("created_at", { ascending: false })
        .limit(10);
      senderInquiries = data ?? [];

      if (senderInquiries.length) {
        const wanted = normalizeSubject(mail.subject);
        const { data: priorMessages } = await supabase
          .from("complex_inquiry_messages")
          .select("inquiry_id, subject")
          .in("inquiry_id", senderInquiries.map((r) => r!.id))
          .order("created_at", { ascending: false })
          .limit(200);
        const hit = wanted
          ? (priorMessages ?? []).find((m) => normalizeSubject(m.subject) === wanted)
          : null;
        inquiry = hit ? senderInquiries.find((r) => r!.id === hit.inquiry_id) ?? null : null;
      }
    }

    if (!inquiry) {
      // Everything else gets forwarded - a real person emailed us and would
      // otherwise hear nothing back. This is the path a cold email takes, and
      // the one that carries confirmation codes for the Gmail send-as setup.
      console.warn("Inbound mail matched no inquiry:", mail.from);
      return await handleStandaloneMail(supabase, mail, senderInquiries.length);
    }

    // A building, or an area (Search for me).
    const place = await placeOf(supabase, inquiry);
    const complex = place ? { name: place.name } : null;

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
    // A WhatsApp request (SPEC §11): the admin's Gmail reply goes to the
    // renter's WhatsApp, not their inbox - they may have given no email at all.
    // Keyed on the mail's message id, so a webhook redelivery sends it once.
    if (fromHausto && inquiry.channel === "WHATSAPP") {
      let relayed = true;
      try {
        const sent = await sendConciergeWhatsApp(
          supabase, new SupabaseMessageStore(supabase), adapterFromEnv(Deno.env.toObject()),
          { inquiryId: inquiry.id, body, key: mail.messageId ?? crypto.randomUUID() },
        );
        if (sent.status === "FAILED") throw new Error("WhatsApp refused the message");
        // The row above is this message; mark it as the one that went out on
        // WhatsApp, so the renter's reply to it routes back to this request.
        if (mail.messageId) {
          await supabase.from("complex_inquiry_messages")
            .update({ channel: "WHATSAPP", whatsapp_message_id: sent.messageId })
            .eq("provider_message_id", mail.messageId);
        }
      } catch (relayError: any) {
        relayed = false;
        const why = relayError instanceof ServiceWindowClosedError
          ? "Their WhatsApp window has closed - WhatsApp only lets us message them again once they write to us."
          : relayError instanceof ConsecutiveMessageError
          ? "They have not replied to your last two WhatsApp messages. Wait for them before sending another."
          : `Sending on WhatsApp failed: ${relayError.message}.`;
        console.error("Failed to relay admin reply to WhatsApp:", relayError);
        await alertAdmin(
          `⚠️ Your reply to ${inquiry.full_name} did not go out`,
          `${why} It is filed on the request in Admin Tools but the renter has not seen it.`,
          body,
        );
      }
      return json({ success: true, matched: true, inquiryId: inquiry.id, direction, relayed, channel: "WHATSAPP" });
    }

    if (fromHausto) {
      // The message row is already stored, so a 500 here would be retried into
      // the duplicate guard and never relayed. Report the failure to the admin
      // instead, while this request still ends as a success.
      // Thread onto the renter's own last message, so our answer lands inside
      // the conversation they started rather than opening a second one next to
      // it. Their client groups on References, so the subject has to be theirs
      // too - and it must never be the admin's, which is our internal
      // notification ("💬 Hoang replied · City Garden [inq-…]").
      const { data: lastFromRenter } = await supabase
        .from("complex_inquiry_messages")
        .select("provider_message_id, subject")
        .eq("inquiry_id", inquiry.id)
        .eq("direction", "inbound")
        .not("provider_message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const threadSubject = lastFromRenter?.subject?.replace(/^((re|fwd?)\s*:\s*)+/i, "") ??
        `Availability at ${complex?.name ?? "your request"}`;
      const threadHeaders: Record<string, string> = {};
      if (lastFromRenter?.provider_message_id) {
        threadHeaders["In-Reply-To"] = lastFromRenter.provider_message_id;
        threadHeaders["References"] = lastFromRenter.provider_message_id;
      }

      let relayed = true;
      try {
        await sendMail({
          from: CONCIERGE_FROM,
          to: [inquiry.email],
          reply_to: CONCIERGE_FROM,
          subject: `Re: ${threadSubject}`,
          headers: threadHeaders,
          html: `
            ${greeting(inquiry.full_name, body)}
            <div>${textToHtml(body)}</div>
            ${signature("Just reply to this email and we'll pick it up.")}
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
        // Groups with the original "🏢 Availability request" notice and every
        // later reply, so one request reads as one conversation.
        headers: conversationHeaders(inqToken(inquiry.id)),
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
