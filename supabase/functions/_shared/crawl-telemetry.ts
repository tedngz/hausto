// Judging a crawl run, and judging a verification pass.
//
// Both exist because of the same failure: a process that completes without
// throwing is not a process that worked. nhatot was crawled daily for 35 days
// while rejecting every candidate, and every run reported success (PLAN-v3
// finding A). Separately, `verify-external-listings` can deactivate an
// arbitrary share of the index on one reason and say nothing - which is how a
// gateway change or a block would look right up until the index was empty.
//
// Pure, so the thresholds are testable without a crawl, and so the same
// verdict can be asserted in CI rather than read off a dashboard nobody opens.

export interface RunCounts {
  attempted: number;
  written: number;
  updated: number;
  duplicates: number;
  rejected: number;
  /** Rejection reason → count, e.g. `{"too_few_images:1": 47}`. */
  reasons: Record<string, number>;
}

export type Verdict =
  | 'OK'
  | 'NOTHING_ATTEMPTED'
  | 'ALL_REJECTED'
  | 'DOMINANT_REJECTION'
  | 'NOTHING_WRITTEN';

export interface RunAssessment {
  healthy: boolean;
  verdict: Verdict;
  /** One line, written to be read in a log at speed. */
  message: string;
  dominantReason?: string;
  dominantShare?: number;
}

/**
 * When one rejection reason accounts for this much of a run, the run has a
 * cause rather than a spread of ordinary misses.
 *
 * 0.8 rather than 1.0 on purpose: the nhatot failure was 894 of 894, but a
 * source that degrades to 85% one-reason rejections is the same fault caught
 * a week earlier, which is the entire point of measuring.
 */
export const DOMINANT_REJECTION_SHARE = 0.8;

/** Below this many candidates, shares are noise and are not judged. */
export const MIN_SAMPLE = 5;

export function dominant(reasons: Record<string, number>): { reason: string; count: number } | null {
  let best: { reason: string; count: number } | null = null;
  for (const [reason, count] of Object.entries(reasons)) {
    if (!best || count > best.count) best = { reason, count };
  }
  return best;
}

/**
 * Was this run healthy?
 *
 * "Healthy" is not "did not throw". A run that saw 40 candidates, rejected all
 * 40 for one reason, and returned 200 is the exact shape of the bug this
 * exists to catch.
 */
export function assessRun(counts: RunCounts): RunAssessment {
  const { attempted, written, updated, duplicates, rejected, reasons } = counts;

  // Nothing to judge. A target whose search page was empty is not a fault -
  // it is a quiet day, and flagging it would train everyone to ignore the flag.
  if (attempted === 0) {
    return { healthy: true, verdict: 'NOTHING_ATTEMPTED', message: 'No candidates on the page; nothing to judge.' };
  }

  const top = dominant(reasons);
  const share = top ? top.count / attempted : 0;

  if (rejected >= attempted && attempted >= MIN_SAMPLE) {
    return {
      healthy: false,
      verdict: 'ALL_REJECTED',
      message: `Every one of ${attempted} candidates was rejected` +
        (top ? ` - ${top.count} as ${top.reason}` : '') + '. The source is not quiet, it is broken.',
      dominantReason: top?.reason,
      dominantShare: share,
    };
  }

  if (top && attempted >= MIN_SAMPLE && share >= DOMINANT_REJECTION_SHARE) {
    return {
      healthy: false,
      verdict: 'DOMINANT_REJECTION',
      message: `${top.reason} accounted for ${top.count} of ${attempted} candidates (${Math.round(share * 100)}%).`,
      dominantReason: top.reason,
      dominantShare: share,
    };
  }

  // Saw candidates, kept none of them, and did not reject them either - so
  // they vanished somewhere unaccounted for. Rarer and worse than a rejection,
  // because there is no reason recorded to look up.
  if (written === 0 && updated === 0 && duplicates === 0 && attempted >= MIN_SAMPLE) {
    return {
      healthy: false,
      verdict: 'NOTHING_WRITTEN',
      message: `${attempted} candidates produced no write, no update and no duplicate. They went somewhere unaccounted for.`,
      dominantReason: top?.reason,
      dominantShare: share,
    };
  }

  return {
    healthy: true,
    verdict: 'OK',
    message: `${written} written, ${updated} updated, ${duplicates} duplicate, ${rejected} rejected of ${attempted}.`,
    dominantReason: top?.reason,
    dominantShare: share,
  };
}

// ── Verification passes ─────────────────────────────────────────────────────

/**
 * PLAN-v3 S1: "a single verification reason cannot silently deactivate more
 * than 20% of a run".
 *
 * Lower than the crawl threshold, and deliberately: deactivation removes
 * supply that already exists, where a rejection only declines to add some.
 * Twenty percent of the live index disappearing on one reason is either a
 * genuine cull or the gateway changing its mind about us, and both are worth
 * a human look before the next pass repeats it.
 */
export const DEACTIVATION_REASON_SHARE = 0.2;

export interface VerificationAssessment {
  healthy: boolean;
  message: string;
  reason?: string;
  share?: number;
}

export function assessVerification(counts: {
  checked: number;
  reasons: Record<string, number>;
}): VerificationAssessment {
  if (counts.checked < MIN_SAMPLE) {
    return { healthy: true, message: `Only ${counts.checked} checked; too few to judge.` };
  }
  const top = dominant(counts.reasons);
  if (!top) return { healthy: true, message: `${counts.checked} checked, nothing deactivated.` };

  const share = top.count / counts.checked;
  if (share > DEACTIVATION_REASON_SHARE) {
    return {
      healthy: false,
      reason: top.reason,
      share,
      message:
        `"${top.reason}" deactivated ${top.count} of ${counts.checked} checked (${Math.round(share * 100)}%), ` +
        `over the ${Math.round(DEACTIVATION_REASON_SHARE * 100)}% ceiling. ` +
        'Either a real cull or the source changing its mind about us - look before the next pass repeats it.',
    };
  }
  return { healthy: true, reason: top.reason, share, message: `${counts.checked} checked, worst reason ${Math.round(share * 100)}%.` };
}
