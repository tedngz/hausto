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

/**
 * Polar signs webhooks to the Standard Webhooks spec: HMAC-SHA256 over
 * "<id>.<timestamp>.<body>", the result base64-encoded, listed in
 * webhook-signature as one or more "v1,<sig>" entries.
 *
 * The key depends on when the secret was minted, and Polar changed this on
 * 8 September 2026. Newer secrets are base64 and are decoded to key bytes the
 * way the spec says; older "Polar HMAC" ones are used as their own raw UTF-8
 * bytes - which is what polar-js does when it base64-encodes the secret before
 * handing it to the standardwebhooks library. Both derivations are tried
 * because either is legitimate depending on the secret's age, and an attacker
 * who knows neither secret cannot forge either MAC.
 */
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

async function signatureValid(req: Request, raw: string): Promise<boolean> {
  const id = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signatures = req.headers.get("webhook-signature");
  if (!POLAR_WEBHOOK_SECRET || !id || !timestamp || !signatures) return false;

  // Reject replays of an old delivery; five minutes is the spec's tolerance.
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) return false;

  const signed = `${id}.${timestamp}.${raw}`;
  const bare = POLAR_WEBHOOK_SECRET.replace(/^whsec_/, "");

  const candidates: Uint8Array[] = [];
  // Standard Webhooks: the secret is base64, decoded to the key.
  try {
    candidates.push(Uint8Array.from(atob(bare), (c) => c.charCodeAt(0)));
  } catch {
    // Not valid base64 - it can only be a legacy secret.
  }
  // Legacy Polar HMAC: the secret's own bytes are the key.
  candidates.push(new TextEncoder().encode(POLAR_WEBHOOK_SECRET));

  const offered = signatures.split(" ").map((entry) => entry.split(",")[1]).filter(Boolean);
  for (const keyBytes of candidates) {
    const expected = await hmacBase64(keyBytes, signed);
    if (offered.some((sig) => safeEqual(sig, expected))) return true;
  }
  return false;
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

  if (!(await signatureValid(req, raw))) {
    logStep("Rejected: bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

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
