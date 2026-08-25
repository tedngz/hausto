// The contract for summoning the platform assistant from anywhere.
//
// Lives on its own rather than in the chat so a leaf component - a property
// card, say - can ask for the assistant without importing it, and so the
// direction of the dependency stays one-way.
//
//   window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, {
//     detail: { propertyId, title },
//   }));
//
// The hub's chat listens for it directly and pins the listing in place.
// Everywhere else AssistantHandoff, mounted app-wide, carries the listing to
// the hub and follows it there; signed-out visitors are asked to sign in
// rather than having the click swallowed.

export const ASSISTANT_OPEN_EVENT = 'openHaustoAssistant';

export interface AssistantOpenDetail {
  /** Listing the conversation should be about, if summoned from one */
  propertyId?: string;
  /** Shown in the assistant's subject strip so the renter can see the scope */
  title?: string;
}

// Summons the assistant with several listings pinned AND an opening question
// already asked - what the browse table's Compare button fires, so weighing up
// a shortlist starts as a conversation rather than a one-shot panel.
//
//   window.dispatchEvent(new CustomEvent(ASSISTANT_COMPARE_EVENT, {
//     detail: { properties, prompt },
//   }));

// Comparing is one gesture with two halves - the side-by-side panel and the
// question about what is in it - so both surfaces that raise it open the panel
// AND fire this. On the hub the chat hears it and asks in the rail while the
// panel stays up beside it; off the hub AssistantHandoff carries the selection
// there, where the panel reopens on arrival.
export const ASSISTANT_COMPARE_EVENT = 'haustoAssistantCompare';

export interface AssistantCompareDetail {
  properties: AssistantOpenDetail[];
  /** Sent as the renter's first message once the listings are pinned */
  prompt: string;
}

/**
 * "A and B" / "A, B and C" - for naming pinned subjects inside the message.
 *
 * The ids travel separately and carry the full record, but the sentence has to
 * stand on its own: "compare these two" with no antecedent is what makes the
 * model ask which ones you meant.
 */
export const listSubjects = (names: string[]): string => {
  const clean = names.map((n) => (n || '').trim()).filter(Boolean);
  if (clean.length === 0) return 'these';
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
};
