// The contract for asking for the Hausto Pass from anywhere.
//
// Lives on its own, like assistantEvents, so a leaf component - a property
// card's Deep Scan chip, say - can put the plan in front of a renter without
// importing the modal, and without every surface that renders a card having to
// thread an onRequestPass callback down to it.
//
//   window.dispatchEvent(new CustomEvent(PASS_MODAL_EVENT));
//
// PassGate, mounted app-wide, listens and opens the plan modal. Signed-out
// visitors are sent to sign in instead: a pass is bought against an account.

export const PASS_MODAL_EVENT = 'openHaustoPassModal';

export interface PassModalDetail {
  /** Which ceiling was hit, so the modal can lead with the relevant line. */
  reason?: 'viewings' | 'ai';
}

/** Sugar for the dispatch above, so call sites read as an intent. */
export const requestPass = (detail: PassModalDetail = {}) => {
  window.dispatchEvent(new CustomEvent<PassModalDetail>(PASS_MODAL_EVENT, { detail }));
};
