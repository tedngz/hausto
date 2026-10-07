import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { base64UrlNoPad, sameBodyHash } from './qstash-body-hash.ts';

const digest = (body: string) => new Uint8Array(createHash('sha256').update(body).digest());

// The chained backfill's own body: its hash has a `/` in standard base64.
const BACKFILL = JSON.stringify({ action: 'backfill-vibe', continuation: true, source: 'post-crawl' });
// The body that did get through on 2026-10-07: no `+` or `/` in its hash.
const SCHEDULE = JSON.stringify({ source: 'qstash' });

describe('the body hash in a QStash JWT', () => {
  it('matches in base64url, as QStash sends it - the case that was refused', () => {
    const claim = createHash('sha256').update(BACKFILL).digest('base64url');
    expect(claim).toContain('_');
    expect(sameBodyHash(claim, digest(BACKFILL))).toBe(true);
  });

  it('matches with or without padding, in either alphabet', () => {
    const d = digest(BACKFILL);
    const std = createHash('sha256').update(BACKFILL).digest('base64');
    for (const claim of [std, std.replace(/=+$/, ''), base64UrlNoPad(std), base64UrlNoPad(std) + '=']) {
      expect(sameBodyHash(claim, d)).toBe(true);
    }
  });

  it('still matches the body that always got through', () => {
    const claim = createHash('sha256').update(SCHEDULE).digest('base64');
    expect(sameBodyHash(claim, digest(SCHEDULE))).toBe(true);
  });

  it('refuses a body that is not the one signed', () => {
    const claim = createHash('sha256').update(BACKFILL).digest('base64url');
    expect(sameBodyHash(claim, digest(BACKFILL + ' '))).toBe(false);
    expect(sameBodyHash(claim, digest(SCHEDULE))).toBe(false);
    expect(sameBodyHash('', digest(BACKFILL))).toBe(false);
  });
});
