// The contract for summoning the platform assistant from anywhere.
//
// Lives on its own rather than in AIAssistant so a leaf component - a property
// card, say - can ask for the assistant without importing it, and so the
// direction of the dependency stays one-way.
//
//   window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, {
//     detail: { propertyId, title },
//   }));
//
// AIAssistant is mounted app-wide and listens for it. Signed-out visitors have
// no assistant, so it routes them to sign in rather than swallowing the click.

export const ASSISTANT_OPEN_EVENT = 'openHaustoAssistant';

export interface AssistantOpenDetail {
  /** Listing the conversation should be about, if summoned from one */
  propertyId?: string;
  /** Shown in the assistant's subject strip so the renter can see the scope */
  title?: string;
}
