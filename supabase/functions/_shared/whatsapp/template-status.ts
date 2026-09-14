// What Meta currently thinks of our templates, versus what the code believes.
//
// `templates.ts` carries an `approved` flag that a human flips after Meta
// approves a template. That flag is a deploy gate and it should stay one - a
// template nobody has reviewed should not become sendable because an API said
// so. What it cannot do is notice the reverse: a template Meta later REJECTED,
// PAUSED for quality, or DISABLED stays `true` in the code forever, and the
// first sign is a `graph_400` on a message that mattered.
//
// So this reconciles rather than replaces. The code flag says "we intend to
// send this"; Meta's status says "you may". A send needs both, and the gap
// between them is the thing worth alarming on.
//
// Pure, so the comparison is testable without a WABA - which matters
// particularly here, because there is no WABA yet.

import { TEMPLATES, type TemplateSpec } from './templates.ts';

/**
 * Template states Meta reports. Only APPROVED permits a send; the rest are
 * listed so a drift report can say which kind of not-approved it is, since the
 * remedies differ - a REJECTED template needs editing and resubmitting, a
 * PAUSED one needs the quality problem fixed, a PENDING one needs patience.
 */
export const SENDABLE_STATUS = 'APPROVED';

export interface MetaTemplate {
  name: string;
  status: string;
  category?: string;
  language?: string;
  /** Meta's own id, kept so a later call can address the template directly. */
  id?: string;
  /** Quality as Meta rates it: GREEN / YELLOW / RED, or UNKNOWN. */
  quality?: string;
}

/**
 * Pull the templates out of a `/{waba-id}/message_templates` response.
 *
 * Defensive about shape: a field Meta renames should degrade to "unknown
 * status", which the drift report flags, rather than throwing inside a cron
 * job where nobody reads the stack trace.
 */
// deno-lint-ignore no-explicit-any
export function parseMetaTemplates(payload: any): MetaTemplate[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const out: MetaTemplate[] = [];
  for (const r of rows) {
    const name = typeof r?.name === 'string' ? r.name : '';
    if (!name) continue;
    out.push({
      name,
      status: typeof r?.status === 'string' ? r.status.toUpperCase() : 'UNKNOWN',
      category: typeof r?.category === 'string' ? r.category : undefined,
      language: typeof r?.language === 'string' ? r.language : undefined,
      id: typeof r?.id === 'string' ? r.id : undefined,
      quality: typeof r?.quality_score?.score === 'string'
        ? r.quality_score.score.toUpperCase()
        : undefined,
    });
  }
  return out;
}

export type DriftKind =
  /** Code says sendable, Meta does not. The dangerous one. */
  | 'CODE_AHEAD_OF_META'
  /** Meta approved it, the code flag is still false. Flip and deploy. */
  | 'META_AHEAD_OF_CODE'
  /** In our registry, Meta has never heard of it. Not submitted yet. */
  | 'NOT_SUBMITTED'
  /** Meta has a template we do not know about. Informational. */
  | 'UNKNOWN_TO_CODE'
  /** Approved and flagged, but Meta rates its quality badly. */
  | 'QUALITY_WARNING';

export interface Drift {
  kind: DriftKind;
  templateName: string;
  metaStatus?: string;
  codeApproved?: boolean;
  /** True when this should wake somebody rather than sit in a table. */
  urgent: boolean;
  message: string;
}

/**
 * Compare Meta's view with the registry.
 *
 * Note what counts as urgent, and what does not. A template we have not
 * submitted is a to-do, not an incident. A template Meta approved that the
 * code has not enabled is working as designed - the deploy gate is deliberate.
 * The urgent case is the one direction that can actually send: the code
 * believes it may, and Meta disagrees.
 */
export function reconcile(
  metaTemplates: MetaTemplate[],
  registry: Record<string, TemplateSpec> = TEMPLATES as unknown as Record<string, TemplateSpec>,
): Drift[] {
  const drifts: Drift[] = [];
  const byName = new Map(metaTemplates.map(t => [t.name, t]));
  const known = new Set<string>();

  for (const spec of Object.values(registry)) {
    known.add(spec.name);
    const meta = byName.get(spec.name);

    if (!meta) {
      drifts.push({
        kind: spec.approved ? 'CODE_AHEAD_OF_META' : 'NOT_SUBMITTED',
        templateName: spec.name,
        codeApproved: spec.approved,
        urgent: spec.approved,
        message: spec.approved
          // The code would send this right now and Meta has no record of it.
          ? `"${spec.name}" is flagged approved in templates.ts but Meta has no template by that name. Every send of it will be rejected.`
          : `"${spec.name}" has not been submitted to Meta yet.`,
      });
      continue;
    }

    if (spec.approved && meta.status !== SENDABLE_STATUS) {
      drifts.push({
        kind: 'CODE_AHEAD_OF_META',
        templateName: spec.name,
        metaStatus: meta.status,
        codeApproved: true,
        urgent: true,
        message:
          `"${spec.name}" is flagged approved in templates.ts but Meta reports ${meta.status}. ` +
          'Sends will be rejected until this is resolved.',
      });
      continue;
    }

    if (!spec.approved && meta.status === SENDABLE_STATUS) {
      drifts.push({
        kind: 'META_AHEAD_OF_CODE',
        templateName: spec.name,
        metaStatus: meta.status,
        codeApproved: false,
        urgent: false,
        message:
          `"${spec.name}" is APPROVED at Meta but still approved: false in templates.ts. ` +
          'Flip the flag and deploy to start using it.',
      });
      continue;
    }

    // Approved both sides. Quality is the remaining thing that can bite: a RED
    // rating precedes Meta pausing the template, so it is a warning with time
    // on it rather than a failure.
    if (spec.approved && meta.quality === 'RED') {
      drifts.push({
        kind: 'QUALITY_WARNING',
        templateName: spec.name,
        metaStatus: meta.status,
        codeApproved: true,
        urgent: true,
        message: `"${spec.name}" is approved but Meta rates its quality RED. It is close to being paused.`,
      });
    }
  }

  for (const meta of metaTemplates) {
    if (known.has(meta.name)) continue;
    drifts.push({
      kind: 'UNKNOWN_TO_CODE',
      templateName: meta.name,
      metaStatus: meta.status,
      urgent: false,
      message: `Meta has a template "${meta.name}" (${meta.status}) that templates.ts does not list.`,
    });
  }

  return drifts;
}

/** Rows for `whatsapp_template_status`, the cache `sendTemplate` consults. */
export function statusRows(metaTemplates: MetaTemplate[]): Record<string, unknown>[] {
  const now = new Date().toISOString();
  return metaTemplates.map(t => ({
    name: t.name,
    status: t.status,
    category: t.category ?? null,
    language: t.language ?? null,
    meta_id: t.id ?? null,
    quality: t.quality ?? null,
    last_synced_at: now,
  }));
}

export function summarise(drifts: Drift[]): { urgent: number; total: number; message: string } {
  const urgent = drifts.filter(d => d.urgent);
  return {
    urgent: urgent.length,
    total: drifts.length,
    message: urgent.length === 0
      ? `${drifts.length} difference(s), none urgent.`
      : urgent.map(d => d.message).join(' | '),
  };
}
