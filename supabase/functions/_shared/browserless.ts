// Browserless is paused unless the BROWSERLESS_ENABLED secret says "true".
//
// Paused on 2026-10-27: the free plan had 56 of 1,000 units left with 24 days
// of the cycle to go, most of them captcha units from extract-phone's
// Cloudflare solve. Off by default so the pause takes effect on deploy, with
// no secret to set first; resuming is one secret in the dashboard.
//
// It governs listing verification only. Phone reveals no longer use a browser
// at all, whatever this says: since 2026-10-27 (owner's decision) a number a
// source does not publish for free is found by hand, so extract-phone has no
// Browserless path to switch back on.
//
// While paused, verify-external-listings leaves batdongsan rows alone (their
// checks are Browserless-only), and nhatot keeps its gateway error rather than
// falling back. Rows keep their state; the 45-day age cap still applies to them.
export function browserlessEnabled(): boolean {
  return (Deno.env.get('BROWSERLESS_ENABLED') ?? '').trim().toLowerCase() === 'true';
}
