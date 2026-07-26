// Shared plumbing for the concierge email thread on a complex availability
// request (public.complex_inquiries + public.complex_inquiry_messages).
//
// Renters only ever see hello@hausto.com. Every message we send sets Reply-To
// to a plus-addressed variant carrying the inquiry id, so an inbound mail can
// be filed against the right request without guessing from the sender address.

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

/** hello+inq-<uuid without dashes>@hausto.com */
export function replyAddress(inquiryId: string): string {
  return `hello+inq-${inquiryId.replace(/-/g, "")}@hausto.com`;
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

/** Everything above the first quoted-reply marker, so threads stay readable. */
export function stripQuotedReply(text: string): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((line) =>
    /^\s*>/.test(line) ||
    /^\s*On .+ wrote:\s*$/.test(line) ||
    /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) ||
    /^\s*_{10,}\s*$/.test(line)
  );
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  return kept.join("\n").trim();
}

export function textToHtml(text: string): string {
  return esc(text).replace(/\n/g, "<br>");
}
