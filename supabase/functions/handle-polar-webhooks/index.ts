import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { recordPolarPurchase } from "../_shared/polar-pass.ts";

// Polar's order.paid webhook: the path that records a purchase when the browser
// never comes back.
//
// The redirect flow alone loses money. A renter who pays and closes the tab, or
// whose phone drops the connection on the way back to /pass-success, is charged
// and gets nothing - and the only trace is a Polar order with no matching row.
// This function closes that hole: Polar reports the payment server-to-server,
// so the pass lands whether or not anyone returns to the site.
//
// Both paths write the same row keyed on the checkout id, so whichever arrives
// first wins and the other reports what it found. See _shared/polar-pass.ts.

const POLAR_WEBHOOK_SECRET = Deno.env.get("POLAR_WEBHOOK_SECRET");

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[HANDLE-POLAR-WEBHOOKS] ${step}${detailsStr}`);
};

/** Timing-safe compare, so a bad signature leaks nothing through response time. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacBase64(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** base64, accepting the URL-safe alphabet and missing padding. atob takes neither. */
function decodeBase64(value: string): Uint8Array | null {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Polar signs webhooks to the Standard Webhooks spec: HMAC-SHA256 over
 * "<id>.<timestamp>.<body>", base64-encoded, listed in webhook-signature as one
 * or more "v1,<sig>" entries.
 *
 * How the key is derived from the secret is the part that varies, so every
 * plausible derivation is tried rather than assuming one:
 *
 *  - Standard Webhooks (Polar's format since 8 September 2026): the secret is
 *    base64 and decodes to the key. It may carry a whsec_ prefix, and may use
 *    the URL-safe alphabet, which atob rejects outright.
 *  - Legacy "Polar HMAC": the secret's own UTF-8 bytes are the key - what
 *    polar-js produces when it base64-encodes the secret before handing it to
 *    the standardwebhooks library.
 *
 * Trying all of them costs four HMACs and cannot weaken anything: an attacker
 * who does not hold the secret can forge none of them. Getting it wrong the
 * other way silently drops paid orders, which is the expensive direction.
 */
async function verifySignature(
  req: Request,
  raw: string,
): Promise<{ ok: boolean; why?: string; via?: string }> {
  const id = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signatures = req.headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) {
    return { ok: false, why: `missing headers (id=${!!id} ts=${!!timestamp} sig=${!!signatures})` };
  }

  // Reject replays; five minutes is the spec's tolerance. The spec says seconds,
  // but a millisecond timestamp would read as wildly out of tolerance and drop
  // every delivery, so both are accepted and measured on their own scale.
  const ts = Number(timestamp);
  const nowSec = Date.now() / 1000;
  const skew = Number.isFinite(ts)
    ? Math.min(Math.abs(nowSec - ts), Math.abs(nowSec - ts / 1000))
    : NaN;
  if (!Number.isFinite(skew) || skew > 300) {
    return { ok: false, why: `timestamp out of tolerance (skew=${Math.round(skew)}s)` };
  }

  const secret = (POLAR_WEBHOOK_SECRET ?? "").trim();
  const bare = secret.replace(/^(whsec_|polar_whsec_)/, "");

  const encoder = new TextEncoder();
  const candidates: Array<[string, Uint8Array | null]> = [
    ["base64(bare)", decodeBase64(bare)],
    ["base64(whole)", decodeBase64(secret)],
    ["utf8(whole)", encoder.encode(secret)],
    ["utf8(bare)", encoder.encode(bare)],
  ];

  const signed = `${id}.${timestamp}.${raw}`;
  const offered = signatures.split(" ").map((entry) => entry.split(",")[1]).filter(Boolean);

  for (const [label, keyBytes] of candidates) {
    if (!keyBytes || keyBytes.length === 0) continue;
    const expected = await hmacBase64(keyBytes, signed);
    if (offered.some((sig) => safeEqual(sig, expected))) return { ok: true, via: label };
  }

  // Nothing about the secret itself is logged - only the shape of what arrived,
  // which is what tells a misconfigured secret apart from a real forgery.
  return {
    ok: false,
    why: `no derivation matched (offered=${offered.length}, secretLen=${secret.length}, ` +
      `prefixed=${secret !== bare}, trimmed=${secret !== (POLAR_WEBHOOK_SECRET ?? "")})`,
  };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read the body as text once: the signature covers the exact bytes sent, so
  // it cannot be re-serialised from parsed JSON.
  const raw = await req.text();

  if (!POLAR_WEBHOOK_SECRET) {
    // Refuse rather than accept unverified payment events. 500 so Polar retries
    // once the secret is configured instead of dropping the delivery.
    logStep("POLAR_WEBHOOK_SECRET is not configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const verified = await verifySignature(req, raw);
  if (!verified.ok) {
    logStep("Rejected: bad signature", { why: verified.why });
    return new Response("Invalid signature", { status: 401 });
  }
  logStep("Signature verified", { via: verified.via });

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    // Malformed and signed: retrying will not help, so take it off the queue.
    logStep("Rejected: body is not JSON");
    return new Response("Bad request", { status: 400 });
  }

  // Only order.paid grants anything. Everything else is acknowledged so Polar
  // stops resending it - an endpoint is disabled after 10 consecutive failures,
  // so returning an error for events we simply don't act on would eventually
  // take the ones we do care about down with it.
  if (event.type !== "order.paid") {
    logStep("Ignoring event", { type: event.type });
    return new Response(JSON.stringify({ ignored: event.type }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const order = (event.data ?? {}) as Record<string, unknown>;
  const checkoutId = order.checkout_id as string | undefined;
  if (!checkoutId) {
    // An order with no checkout behind it was not started by this service.
    logStep("Ignoring order with no checkout_id", { orderId: order.id });
    return new Response(JSON.stringify({ ignored: "no checkout_id" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  try {
    const accessToken = Deno.env.get("POLAR_ACCESS_TOKEN");
    if (!accessToken) throw new Error("Polar credentials not configured");
    const apiBase = Deno.env.get("POLAR_API_BASE") ?? "https://sandbox-api.polar.sh";

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    logStep("Recording paid order", { orderId: order.id, checkoutId });

    // No expectedRenterId: there is no session here, so the renter comes from
    // the checkout's own metadata. attempts stays at 1 - order.paid already
    // means the money moved, and Polar wants an answer inside two seconds, so
    // a checkout that still reads unsettled is better left to Polar's retry.
    const result = await recordPolarPurchase({
      supabase: supabaseClient,
      apiBase,
      accessToken,
      checkoutId,
      log: logStep,
    });

    if (result.status === 'pending') {
      // 500 puts it back on Polar's queue with backoff rather than dropping it.
      logStep("Checkout not settled; asking Polar to retry", { checkoutId });
      return new Response(JSON.stringify({ pending: true }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }

    logStep("Done", { checkoutId, status: result.status, kind: result.kind });
    return new Response(JSON.stringify({ ok: true, status: result.status }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR handling order.paid", { checkoutId, message });
    // 500 so Polar retries: a transient database or API failure must not cost
    // a renter the pass they paid for.
    return new Response(JSON.stringify({ error: message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
