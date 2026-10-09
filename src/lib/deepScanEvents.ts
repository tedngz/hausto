// The contract for asking for a listing's Deep scan from anywhere.
//
// The scan is long - layout, fit, downsides, neighbourhood, commute - and it is
// written against the renter's preferences, so it is something to sit and read
// rather than something to squint at. A popover hanging off a chip is the wrong
// shape for it: it covers the card the scan is about, and on a phone there is
// barely room for the first paragraph.
//
// So the chip asks, and the hub's chat answers. The scan lands in the
// conversation, next to the listing it read and next to the AI that can be
// asked about it.
//
//   window.dispatchEvent(new CustomEvent(DEEP_SCAN_EVENT, { detail }));
//
// The hub's chat listens directly. Everywhere else AssistantHandoff carries the
// request to the hub and follows it there, the same way a card's sparkle does.

import type { PropertyType } from '@/hooks/useDeepAnalysis';

export const DEEP_SCAN_EVENT = 'openHaustoDeepScan';

export interface DeepScanDetail {
  propertyId: string;
  /** Named in the chat, where the scan is no longer beside its card. */
  title?: string;
  /** Which ledger the listing lives in - the two id spaces can collide. */
  propertyType?: PropertyType;
}

/** Sugar for the dispatch above, so call sites read as an intent. */
export const openDeepScan = (detail: DeepScanDetail) => {
  window.dispatchEvent(new CustomEvent<DeepScanDetail>(DEEP_SCAN_EVENT, { detail }));
};
