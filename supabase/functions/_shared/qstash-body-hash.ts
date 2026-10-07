// Comparing the body hash a QStash JWT carries with the body that arrived.
//
// QStash puts the SHA-256 of the body in the JWT's `body` claim in base64url -
// `-` and `_` where standard base64 has `+` and `/`. scheduled-crawl compared it
// against btoa(), which is standard base64, so any body whose hash happened to
// contain a `+` or a `/` was refused as tampered with. The backfill-vibe chain's
// bodies do, so every chained backfill was refused, and QStash retried each
// one until it gave up: six refusals a run in the logs of 2026-10-07.
//
// Both sides are brought to base64url without padding before comparing, so
// the check holds whichever alphabet and padding the claim arrives in. That
// weakens nothing - it is the same 32 bytes either way.

export function base64UrlNoPad(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sameBodyHash(claim: string, digest: Uint8Array): boolean {
  const ours = btoa(String.fromCharCode(...digest));
  return base64UrlNoPad(claim) === base64UrlNoPad(ours);
}
