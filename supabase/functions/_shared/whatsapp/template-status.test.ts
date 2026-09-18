import { describe, it, expect } from 'vitest';
import {
  parseMetaTemplates,
  reconcile,
  statusRows,
  summarise,
  SENDABLE_STATUS,
  type MetaTemplate,
} from './template-status.ts';
import { TEMPLATES, type TemplateSpec } from './templates.ts';

const spec = (name: string, approved: boolean): TemplateSpec => ({
  name, params: ['a'], purpose: 'test', approved,
});

const meta = (name: string, status: string, quality?: string): MetaTemplate => ({ name, status, quality });

describe('parsing Meta responses', () => {
  it('reads the fields that matter', () => {
    const parsed = parseMetaTemplates({
      data: [{
        name: 'itinerary_ready', status: 'approved', category: 'UTILITY',
        language: 'en', id: '123', quality_score: { score: 'green' },
      }],
    });
    expect(parsed).toEqual([{
      name: 'itinerary_ready', status: 'APPROVED', category: 'UTILITY',
      language: 'en', id: '123', quality: 'GREEN',
    }]);
  });

  it('degrades to UNKNOWN rather than throwing inside a cron job', () => {
    // A field Meta renames should produce a drift report somebody reads, not a
    // stack trace nobody does.
    expect(parseMetaTemplates({ data: [{ name: 'x' }] })[0].status).toBe('UNKNOWN');
    expect(parseMetaTemplates({})).toEqual([]);
    expect(parseMetaTemplates(null)).toEqual([]);
    expect(parseMetaTemplates({ data: [{ status: 'APPROVED' }] })).toEqual([]); // no name, no row
  });
});

describe('the dangerous direction: code ahead of Meta', () => {
  it('flags a template the code would send that Meta has rejected', () => {
    const d = reconcile([meta('itinerary_ready', 'REJECTED')], { A: spec('itinerary_ready', true) });
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('CODE_AHEAD_OF_META');
    expect(d[0].urgent).toBe(true);
    expect(d[0].message).toContain('REJECTED');
  });

  it('flags a paused template, which is the case a code flag can never notice', () => {
    // This is the whole reason the module exists: approval is not permanent.
    const d = reconcile([meta('itinerary_ready', 'PAUSED')], { A: spec('itinerary_ready', true) });
    expect(d[0].kind).toBe('CODE_AHEAD_OF_META');
    expect(d[0].urgent).toBe(true);
  });

  it('flags a template flagged approved that Meta has never heard of', () => {
    const d = reconcile([], { A: spec('itinerary_ready', true) });
    expect(d[0].kind).toBe('CODE_AHEAD_OF_META');
    expect(d[0].urgent).toBe(true);
    expect(d[0].message).toContain('no template by that name');
  });
});

describe('what is deliberately not urgent', () => {
  it('treats an unsubmitted template as a to-do, not an incident', () => {
    const d = reconcile([], { A: spec('viewing_reminder', false) });
    expect(d[0].kind).toBe('NOT_SUBMITTED');
    expect(d[0].urgent).toBe(false);
  });

  it('treats Meta-approved-but-code-disabled as working as designed', () => {
    // The deploy gate is intentional: a template nobody reviewed must not
    // become sendable because an API said so.
    const d = reconcile([meta('viewing_reminder', 'APPROVED')], { A: spec('viewing_reminder', false) });
    expect(d[0].kind).toBe('META_AHEAD_OF_CODE');
    expect(d[0].urgent).toBe(false);
    expect(d[0].message).toContain('Flip the flag');
  });

  it('mentions a template Meta has that we do not, without alarming', () => {
    const d = reconcile([meta('some_old_thing', 'APPROVED')], { A: spec('itinerary_ready', false) });
    const unknown = d.find(x => x.kind === 'UNKNOWN_TO_CODE');
    expect(unknown?.urgent).toBe(false);
  });
});

describe('quality', () => {
  it('warns on RED, because Meta pauses templates that stay there', () => {
    const d = reconcile([meta('itinerary_ready', 'APPROVED', 'RED')], { A: spec('itinerary_ready', true) });
    expect(d[0].kind).toBe('QUALITY_WARNING');
    expect(d[0].urgent).toBe(true);
  });

  it('says nothing about GREEN or an unrated template', () => {
    expect(reconcile([meta('t', 'APPROVED', 'GREEN')], { A: spec('t', true) })).toHaveLength(0);
    expect(reconcile([meta('t', 'APPROVED')], { A: spec('t', true) })).toHaveLength(0);
  });
});

describe('agreement is silence', () => {
  it('reports nothing when both sides agree', () => {
    const registry = { A: spec('a', true), B: spec('b', false) };
    const d = reconcile([meta('a', 'APPROVED'), meta('b', 'PENDING')], registry);
    expect(d).toHaveLength(0);
  });

  it('only APPROVED counts as sendable', () => {
    expect(SENDABLE_STATUS).toBe('APPROVED');
    for (const status of ['PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'UNKNOWN']) {
      const d = reconcile([meta('t', status)], { A: spec('t', true) });
      expect(d[0]?.kind, status).toBe('CODE_AHEAD_OF_META');
    }
  });
});

describe('the cache rows and the summary', () => {
  it('builds one row per Meta template', () => {
    const rows = statusRows([meta('a', 'APPROVED', 'GREEN')]);
    expect(rows[0]).toMatchObject({ name: 'a', status: 'APPROVED', quality: 'GREEN' });
    expect(rows[0].last_synced_at).toBeTruthy();
  });

  it('summarises urgently or quietly', () => {
    const quiet = summarise(reconcile([meta('t', 'APPROVED')], { A: spec('t', false) }));
    expect(quiet.urgent).toBe(0);
    expect(quiet.message).toContain('none urgent');

    const loud = summarise(reconcile([meta('t', 'REJECTED')], { A: spec('t', true) }));
    expect(loud.urgent).toBe(1);
    expect(loud.message).toContain('REJECTED');
  });
});

describe('against the real registry', () => {
  // Counted from the registry rather than hardcoded: this caught the digest
  // template being added, which is the right kind of catch but not one worth
  // re-editing the test for every time.
  const ALL = Object.keys(TEMPLATES).length;

  it('is silent when Meta agrees every template is approved', () => {
    // Where the registry now stands: all five approved at Meta and flagged
    // sendable in code. reconcile reports drift, so agreement is an empty
    // list - there is nothing to say.
    const d = reconcile(
      Object.values(TEMPLATES).map(t => meta(t.name, 'APPROVED', 'GREEN')),
    );
    expect(d).toHaveLength(0);
    expect(summarise(d).urgent).toBe(0);
  });

  it('shouts when the flags say sendable and Meta has never heard of them', () => {
    // This used to assert the opposite - every template unsubmitted, nothing
    // urgent - which held while they all shipped approved: false. It
    // documented the state of the rollout, not a rule.
    //
    // The rule it was hiding is the one worth having: a template the code will
    // send and Meta does not know about fails on the itinerary somebody is
    // waiting for. With the flags true, an empty Meta response is an
    // emergency on every one of them, and the sync says so.
    const d = reconcile([]);
    expect(d).toHaveLength(ALL);
    expect(d.every(x => x.kind === 'CODE_AHEAD_OF_META')).toBe(true);
    expect(summarise(d).urgent).toBe(ALL);
  });
});
