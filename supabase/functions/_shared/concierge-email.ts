// Shared plumbing for the concierge email thread on a complex availability
// request (public.complex_inquiries + public.complex_inquiry_messages).
//
// Renters only ever see a plain "Hausto <hello@hausto.com>" - a
// plus-addressed token in their Reply-To reads like spam in the client's To
// line, so inbound mail from a renter is matched on their sender address
// instead.
//
// The token is still used for the admin's own copy, where nobody but the admin
// sees it: a Gmail reply comes from the admin's address, which matches no
// renter, so the address is the only thing tying it to a request. It is wrapped
// in a display name there too.

export const CONCIERGE_FROM = "Hausto <hello@hausto.com>";
export const CONCIERGE_INBOX = "hello@hausto.com";
export const ADMIN_EMAIL = "ted.ngz@gmail.com";

// www, not the apex: hausto.com 302s to www, and a fair number of mail clients
// will not follow a redirect to load an image.
export const SITE_URL = "https://www.hausto.com";
// Served from Supabase Storage rather than public/ on the site. The site is
// deployed by Lovable on merge, so an asset added alongside a function change
// is not there yet when the first mail goes out - and a broken mark in a
// renter's inbox is not worth the coupling. Storage is live the moment it is
// uploaded and does not redirect.
export const LOGO_URL =
  "https://gbgrwjdmytaksrztcyzs.supabase.co/storage/v1/object/public/brand/hausto-mark.png";
export const TAGLINE = "Vibe check your next home";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Hausto <hello+inq-<uuid without dashes>@hausto.com> — admin copies only. */
export function replyAddress(inquiryId: string): string {
  return `Hausto <hello+inq-${inquiryId.replace(/-/g, "")}@hausto.com>`;
}

/**
 * " [inq-<uuid without dashes>]" for the end of an admin notification subject.
 *
 * Plus addressing is not guaranteed to survive: it depends on the receiving
 * provider treating hello+tag@ as hello@, which SES and Resend document
 * differently. A subject tag rides along on every client's Reply regardless of
 * provider, so the thread still resolves if the alias is ever dropped. Renters
 * never see it - their relayed copy gets a freshly written subject.
 */
export function subjectToken(inquiryId: string): string {
  return ` [inq-${inquiryId.replace(/-/g, "")}]`;
}

/**
 * Hausto <hello+box-<uuid without dashes>@hausto.com> — the same trick as
 * replyAddress, for mail that matches no availability request. Without it the
 * only answerable address on a cold email is the sender's own, which sends the
 * admin's personal address out and takes the conversation off the system.
 */
export function mailThreadAddress(threadId: string): string {
  return `Hausto <hello+box-${threadId.replace(/-/g, "")}@hausto.com>`;
}

/** " [box-<uuid without dashes>]" — subject-line copy of the thread alias. */
export function mailThreadToken(threadId: string): string {
  return ` [box-${threadId.replace(/-/g, "")}]`;
}

/** "box-<hex>" / "inq-<hex>" — the bare token, for conversationHeaders. */
export const boxToken = (threadId: string) => `box-${threadId.replace(/-/g, "")}`;
export const inqToken = (inquiryId: string) => `inq-${inquiryId.replace(/-/g, "")}`;

/**
 * Headers that put every notice about one conversation in one Gmail thread.
 *
 * We cannot reference our own sent mail: Resend rides on SES, which stamps its
 * own Message-Id (<…@ap-northeast-1.amazonses.com>) and discards any we set, and
 * the id Resend hands back is unrelated to it. So instead every message about a
 * conversation points at the same invented parent. Nothing ever has that
 * Message-Id, which is fine - clients thread on a shared ancestor whether or not
 * they hold it, the way mailing lists have always worked.
 *
 * Gmail also groups on an identical subject, so callers should keep the subject
 * stable across a conversation rather than echoing each incoming "Re:" variant.
 * Between the two, one of them lands.
 *
 * @param token "inq-<hex>" or "box-<hex>"
 */
export function conversationHeaders(token: string): Record<string, string> {
  const root = `<${token}@hausto.com>`;
  return { "In-Reply-To": root, "References": root };
}

/** Pull a standalone mail-thread id out of a recipient list or subject. */
export function mailThreadIdFromText(...values: (string | null | undefined)[]): string | null {
  return tokenFrom(/box-([0-9a-f]{32})/i, values);
}

/** Pull an inquiry id out of anything that might carry the token. */
export function inquiryIdFromText(...values: (string | null | undefined)[]): string | null {
  return tokenFrom(/inq-([0-9a-f]{32})/i, values);
}

/** Shared scan: first value carrying the token wins, rebuilt as a uuid. */
function tokenFrom(pattern: RegExp, values: (string | null | undefined)[]): string | null {
  for (const raw of values) {
    const match = String(raw ?? "").match(pattern);
    if (!match) continue;
    const h = match[1].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return null;
}

/** Pull an inquiry id back out of any address in a To/Cc list. */
export function inquiryIdFromAddresses(addresses: string[]): string | null {
  return inquiryIdFromText(...addresses);
}

/** "Jane Doe <jane@x.com>" -> "jane@x.com" */
export function bareAddress(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  const angled = text.match(/<([^>]+)>/);
  return (angled ? angled[1] : text).trim().toLowerCase();
}

/**
 * Everything above the first quoted-reply marker, so threads stay readable.
 * Gmail wraps its attribution line ("On Sun, 26 Jul 2026 at 12:32, Hausto
 * Concierge <hello@hausto.com> wrote:") across two lines when the address is
 * long, so an "On …" opener is matched against the next line as well.
 */
export function stripQuotedReply(text: string): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((line, i) =>
    /^\s*>/.test(line) ||
    (/^\s*On\b/.test(line) &&
      (/wrote:\s*$/.test(line.trim()) || /wrote:\s*$/.test(`${line} ${lines[i + 1] ?? ""}`.trim()))) ||
    /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) ||
    /^\s*_{10,}\s*$/.test(line) ||
    /^\s*Sent from my /i.test(line)
  );
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  // Trailing marker lines are what a client leaves when it pads a reply above
  // the quote, and they read as a typo in the relayed copy. Gmail's is U+1427
  // (Canadian syllabics final middle dot) - visually a period, but not one, so
  // it is listed explicitly. Blank lines count as padding too: Gmail leaves one
  // below the marker, and a trim that stopped at the blank would leave the
  // marker stranded above it.
  const PADDING_ONLY = /^[\s.\-_\u00b7\u2022\u1427\u200b\u034f]*$/;
  while (kept.length && PADDING_ONLY.test(kept[kept.length - 1] ?? "")) {
    kept.pop();
  }
  return kept.join("\n").trim();
}

export function textToHtml(text: string): string {
  return esc(text).replace(/\n/g, "<br>");
}

/** "Hoang Nguyen" -> "Hoang". A first name reads like a person wrote it. */
export function firstName(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] || "there";
}

/**
 * Does the message already open with its own greeting?
 *
 * Renter-facing mail prepends "Hi <name>," for us, which reads as a stutter
 * when whoever is replying has already typed one - "Hi Hoang, / Hi Hoang, how
 * can we help?". Covers Vietnamese too: renters here get both languages.
 */
export function startsWithGreeting(body: string): boolean {
  const first = String(body ?? "").trimStart().split("\n")[0] ?? "";
  return /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening)|ch[àa]o|xin ch[àa]o)\b/i.test(first);
}

/** The "Hi <name>," line, or nothing if the writer already wrote their own. */
export function greeting(name: string | null | undefined, body: string): string {
  return startsWithGreeting(body) ? "" : `<p>Hi ${esc(firstName(name))},</p>`;
}

/**
 * Sign-off for renter-facing mail: the mark, the wordmark, the tagline, all
 * linked to the site. Tables and inline styles because Gmail strips <style>
 * blocks, and explicit width/height on the image so a blocked-image placeholder
 * does not collapse the layout.
 */
export function signature(note?: string): string {
  return `
    ${note ? `<p style="margin: 24px 0 0; color: #6b7280; font-size: 13px;">${esc(note)}</p>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
      <tr>
        <td style="vertical-align: middle; padding-right: 12px;">
          <a href="${SITE_URL}" style="text-decoration: none;"><img src="${LOGO_URL}" width="36" height="36"
               alt="Hausto" style="display: block; width: 36px; height: 36px; border: 0;"></a>
        </td>
        <td style="vertical-align: middle; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">
          <a href="${SITE_URL}" style="color: #111111; font-size: 16px; font-weight: 700;
             letter-spacing: -0.3px; text-decoration: none;">Hausto</a>
          <div style="color: #6b7280; font-size: 12px; margin-top: 1px;">${esc(TAGLINE)}</div>
          <a href="${SITE_URL}" style="color: #F97316; font-size: 12px; text-decoration: none;"
             >www.hausto.com</a>
        </td>
      </tr>
    </table>`;
}

/** "Re: Re: Availability at X [inq-…]" -> "availability at x", for comparing. */
export function normalizeSubject(subject: string | null | undefined): string {
  return String(subject ?? "")
    .replace(/^((re|fwd?|sv|aw|tr)\s*:\s*)+/i, "")
    .replace(/\s*\[inq-[0-9a-f]{32}\]\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Message-ids from In-Reply-To / References, each kept both as sent and as its
 * bare local part. Outbound rows store the id Resend returns, which is the uuid
 * inside the Message-Id it stamps rather than the whole angle-bracketed header,
 * so matching needs both forms.
 */
export function messageIdCandidates(...headers: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const header of headers) {
    for (const raw of String(header ?? "").match(/<[^>]+>/g) ?? []) {
      out.add(raw);
      const inner = raw.slice(1, -1);
      out.add(inner);
      const local = inner.split("@")[0];
      if (local) out.add(local);
    }
  }
  return [...out];
}
