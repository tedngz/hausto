/**
 * The landing page's chat composer is a doorway, not a room.
 *
 * A renter who types on `/` needs the things that only exist on the hub the
 * moment they hit send: a results pane wide enough to read, the browse table
 * beside it, their matches. So the home composer doesn't answer - it parks the
 * draft here and navigates, and the hub's rail chat sends it and owns the
 * conversation from there. One thread, in the one place that can show it.
 *
 * Module state rather than router state or storage: the draft carries the
 * image `File`s attached to it, which history state and localStorage both
 * handle badly, and it only has to survive a single client-side navigation. A
 * reload in between drops it, which is the right outcome - the hub opens with
 * an empty composer rather than replaying a message the renter has moved on
 * from.
 */

export interface ChatHandoff {
  /** What the renter typed on the landing page. */
  query: string;
  /** Reference images they attached to it. */
  images: File[];
}

let pending: ChatHandoff | null = null;

/** Park the landing page's first message on the way to the hub. */
export const setChatHandoff = (handoff: ChatHandoff) => {
  pending = handoff;
};

/**
 * Read the parked draft without consuming it, so a component can decide what
 * to render from it during a render pass and clear it in an effect.
 */
export const peekChatHandoff = (): ChatHandoff | null => pending;

/** Drop the parked draft, once whoever is going to send it has taken it. */
export const clearChatHandoff = () => {
  pending = null;
};
