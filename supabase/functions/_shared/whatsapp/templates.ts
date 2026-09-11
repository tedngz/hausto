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
    approved: false,
  },
  ITINERARY_READY: {
    name: 'itinerary_ready',
    params: ['renter_name', 'confirmed_count', 'first_viewing_time'],
    purpose:
      'The consolidated itinerary. One message carrying every confirmed viewing - ' +
      'never one per listing, which is what the 3-in-a-row guard enforces.',
    approved: false,
  },
  VIEWING_REMINDER: {
    name: 'viewing_reminder',
    params: ['renter_name', 'viewing_time', 'listing_address'],
    purpose: 'Day-before reminder, typically outside the window.',
    approved: false,
  },
  NO_SUPPLY_SUBSTITUTES: {
    name: 'no_supply_substitutes',
    params: ['renter_name', 'request_ref'],
    purpose:
      'Nothing on the shortlist could be confirmed. Never sent alone - it carries ' +
      'substitutes, because FAILED_NO_SUPPLY with no alternative is a dead end.',
    approved: false,
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function isApprovedTemplate(name: string): boolean {
  return Object.values(TEMPLATES).some(t => t.name === name && t.approved);
}

export function templateByName(name: string): TemplateSpec | undefined {
  return Object.values(TEMPLATES).find(t => t.name === name);
}
