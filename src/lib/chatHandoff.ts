import type { AssistantOpenDetail } from '@/lib/assistantEvents';

/**
 * What a renter carries with them to the hub, which is where the one chat
 * lives.
 *
 * Two entry points park a draft here and navigate:
 *  - the landing page's hero composer, which takes a message but doesn't
 *    answer it - a reply on `/` has no results pane, no table and no matches
 *    beside it;
 *  - a card's sparkle anywhere off the hub, which used to open a floating
 *    assistant panel and now hands the listing over instead.
 *
 * Module state rather than router state or storage: the draft carries image
 * `File`s, which history state and localStorage both handle badly, and it only
 * has to survive a single client-side navigation. A reload in between drops
 * it, which is the right outcome - the hub opens clean rather than replaying
 * something the renter has moved on from.
 */
export interface ChatHandoff {
  /** A message to send on arrival - what they typed on the landing page. */
  query?: string;
  /** Reference images attached to that message. */
  images?: File[];
  /** Listings or complexes to pin, so the conversation opens about them. */
  subjects?: AssistantOpenDetail[];
}

let pending: ChatHandoff | null = null;

/** Park a draft on the way to the hub. */
export const setChatHandoff = (handoff: ChatHandoff) => {
  pending = handoff;
};

/**
 * Read the parked draft without consuming it, so a component can decide what
 * to render from it during a render pass and clear it in an effect.
 */
export const peekChatHandoff = (): ChatHandoff | null => pending;

/** Drop the parked draft, once whoever is going to act on it has taken it. */
export const clearChatHandoff = () => {
  pending = null;
};
