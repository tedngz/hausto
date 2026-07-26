// Shared plumbing for the concierge email thread on a complex availability
// request (public.complex_inquiries + public.complex_inquiry_messages).
//
// Renters only ever see a plain "Hausto Concierge <hello@hausto.com>" - a
// plus-addressed token in their Reply-To reads like spam in the client's To
// line, so inbound mail from a renter is matched on their sender address
// instead.
//
// The token is still used for the admin's own copy, where nobody but the admin
// sees it: a Gmail reply comes from the admin's address, which matches no
// renter, so the address is the only thing tying it to a request. It is wrapped
// in a display name there too.

export const CONCIERGE_FROM = "Hausto Concierge <hello@hausto.com>";
export const CONCIERGE_INBOX = "hello@hausto.com";
export const ADMIN_EMAIL = "ted.ngz@gmail.com";

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

/** Hausto Concierge <hello+inq-<uuid without dashes>@hausto.com> — admin copies only. */
export function replyAddress(inquiryId: string): string {
  return `Hausto Concierge <hello+inq-${inquiryId.replace(/-/g, "")}@hausto.com>`;
}

/** Pull an inquiry id back out of any address in a To/Cc list. */
export function inquiryIdFromAddresses(addresses: string[]): string | null {
  for (const raw of addresses) {
    const match = String(raw).match(/inq-([0-9a-f]{32})/i);
    if (!match) continue;
    const h = match[1].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return null;
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
  return kept.join("\n").trim();
}

export function textToHtml(text: string): string {
  return esc(text).replace(/\n/g, "<br>");
}
