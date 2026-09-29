// A building's agents (PLAN-v3 S7.0).
//
// An availability request (SPEC §11) is answered by asking the agents who hold
// units in that building - and on 2026-09-29, 12 of 23 buildings had no known
// agent at all. The roster is where the ones an operator finds are kept: from
// the building's Zalo and Facebook groups, or its management company's leasing
// desk. Agents who have listed there are derived from their listings and need
// no row; the roster adds the ones the crawl never saw.
//
// Pure. The action is ADD_BUILDING_AGENT / REMOVE_BUILDING_AGENT in
// ops-actions.ts; the read is `ops_building_roster()`.

import { toE164 } from '../whatsapp/inbound.ts';
import type { BuildingAgentSource } from '../viewing-domain.ts';

/** What an operator can add. LISTING is derived, never added by hand. */
export const ADDABLE_SOURCES: readonly BuildingAgentSource[] = ['MANUAL', 'MANAGEMENT'];

export const MAX_AGENT_NAME = 120;
export const MAX_AGENCY = 120;
export const MAX_NOTE = 500;

/** Agents a building needs before requests for it can be answered well. */
export const ROSTER_TARGET = 3;

export interface BuildingAgentInput {
  complexId: string;
  phone: string;
  name: string | null;
  agency: string | null;
  source: BuildingAgentSource;
  note: string | null;
}

export type BuildingAgentValidation =
  | { ok: true; value: BuildingAgentInput }
  | { ok: false; error: string; message: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// deno-lint-ignore no-explicit-any
export function validateBuildingAgent(raw: any): BuildingAgentValidation {
  const complexId = str(raw?.complexId);
  if (!/^[0-9a-f-]{36}$/i.test(complexId)) {
    return { ok: false, error: 'invalid_complex', message: 'Pick a building.' };
  }
  // Agents are Vietnamese, and the bridge resolves a Zalo account from this
  // number - so the strict rule, not the renter one.
  const phone = toE164(str(raw?.phone));
  if (!phone) {
    return { ok: false, error: 'invalid_phone', message: `Not a Vietnamese mobile number: ${str(raw?.phone) || '(empty)'}` };
  }
  const source = (str(raw?.source) || 'MANUAL').toUpperCase() as BuildingAgentSource;
  if (!ADDABLE_SOURCES.includes(source)) {
    return { ok: false, error: 'invalid_source', message: 'Source is MANUAL or MANAGEMENT - listing agents are found on their own.' };
  }
  return {
    ok: true,
    value: {
      complexId,
      phone,
      name: str(raw?.name).slice(0, MAX_AGENT_NAME) || null,
      agency: str(raw?.agency).slice(0, MAX_AGENCY) || null,
      source,
      note: str(raw?.note).slice(0, MAX_NOTE) || null,
    },
  };
}

export interface RosterAgent {
  realtor_id: string;
  sources: BuildingAgentSource[];
  last_reply_at: string | null;
  last_listed_at: string | null;
}

/**
 * Who to ask first: agents who have answered us before, most recently first;
 * then those who listed there most recently; then the rest.
 */
export function rankRoster<T extends RosterAgent>(agents: T[]): T[] {
  const t = (s: string | null) => (s ? Date.parse(s) : 0);
  return [...agents].sort((a, b) =>
    t(b.last_reply_at) - t(a.last_reply_at) || t(b.last_listed_at) - t(a.last_listed_at));
}

/** A building's roster as a sentence of work: how far short of the target it is. */
export function rosterGap(agentCount: number): number {
  return Math.max(0, ROSTER_TARGET - agentCount);
}
