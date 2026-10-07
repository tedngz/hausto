// The approved template registry (CLAUDE.md, message-window rules).
//
// Meta approves templates by name, and a name that is not approved is rejected
// at their end - after we have already written a `messages` row and told
// ourselves we sent something. So `sendTemplate` accepts nothing that is not in
// here, and the check happens before the row is written.
//
// Approval is a human-blocked task that will not be done when this ships. The
// registry existing before the approvals do is the point: it is the list to
// submit, and the code cannot drift from it.

export interface TemplateSpec {
  /** The name as submitted to Meta. Must match exactly. */
  name: string;
  /** Body params, in order. Used to check the call site passes the right count. */
  params: readonly string[];
  /** What it is for, and why it needs to be a template rather than free-form. */
  purpose: string;
  /** Set once Meta has approved it. Until then the adapter refuses to send it. */
  approved: boolean;
}

export const TEMPLATES = {
  REQUEST_RECEIVED: {
    name: 'request_received',
    params: ['renter_name', 'request_ref', 'listing_count'],
    purpose: 'Acknowledges intake. First contact, so there is no open window yet.',
    approved: true,
  },
  ITINERARY_READY: {
    name: 'itinerary_ready',
    params: ['renter_name', 'confirmed_count', 'first_viewing_time'],
    purpose:
      'The consolidated itinerary, when the renter\'s window is shut: it says how many are confirmed and ' +
      'when the first is, and their reply releases the plan itself (deliver.ts, ITINERARY_HELD). ' +
      'One message for every confirmed viewing - never one per listing.',
    approved: true,
  },
  VIEWING_REMINDER: {
    name: 'viewing_reminder',
    params: ['renter_name', 'viewing_time', 'listing_address'],
    purpose:
      'The viewing-day message when the window has shut (viewing-day.ts): the morning of, with every ' +
      'viewing that day in listing_address - where to meet, the agent, their number if they agreed.',
    approved: true,
  },
  WEEKLY_DIGEST: {
    name: 'weekly_digest',
    params: ['renter_name', 'new_count', 'area_summary'],
    purpose:
      'The weekly new-listing digest. Unlike the other four this one is not a reply - it arrives ' +
      'unbidden, which is why it needs its own opt-in (renters.digest_opt_in_at) and why it is ' +
      'almost certainly MARKETING rather than UTILITY when submitted. Submitting it as Utility to ' +
      'dodge the consent bar gets a WABA restricted rather than a template rejected. It carries a ' +
      'summary, not a list: template parameters are positional and cannot hold a variable-length ' +
      'set of listings. The renter replies, which opens the window, and the detail goes free-form.',
    approved: true,
  },
  NEW_PLACES: {
    name: 'new_places',
    params: ['renter_name', 'new_count', 'area_summary'],
    purpose:
      'The digest twice a week for Pass holders (the pricing rework, SPEC §11): "Hi {{1}}, {{2}} new ' +
      'places in {{3}} fit what you are looking for. Reply here if you would like to see them." ' +
      'weekly_digest says "this week", which reads wrong on a Friday, so this replaces it for the ' +
      'digest; watches keep weekly_digest. Marketing, like it, and opt-in only. Approved by Meta ' +
      '2026-10-07, so the Friday run reaches a renter whose window is shut too.',
    approved: true,
  },
  NO_SUPPLY_SUBSTITUTES: {
    name: 'no_supply_substitutes',
    params: ['renter_name', 'request_ref'],
    purpose:
      'Nothing on the shortlist could be confirmed, with the window shut. Sent only when close matches ' +
      'were found - it says so - and their reply releases the message carrying them (deliver.ts).',
    approved: true,
  },
  REQUEST_UPDATE: {
    name: 'request_update',
    params: ['renter_name', 'complex_name'],
    purpose:
      'An availability request (SPEC §11) has news but the 24-hour window shut before the concierge ' +
      'could send it, or a viewing request owes a holding update with the window shut (deliver.ts; {{2}} ' +
      'is then the listing, or "3 places"). Carries no news itself - the renter replies, the window opens, ' +
      'and the detail goes free-form. Utility: it answers a request the renter made. Also the itinerary\'s ' +
      'with the window shut when it is neither ready nor a no-supply with matches - other times on offer, ' +
      'or nothing found yet (deliver.ts). Approved by Meta on 2026-09-30.',
    approved: true,
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function isApprovedTemplate(name: string): boolean {
  return Object.values(TEMPLATES).some(t => t.name === name && t.approved);
}

export function templateByName(name: string): TemplateSpec | undefined {
  return Object.values(TEMPLATES).find(t => t.name === name);
}
