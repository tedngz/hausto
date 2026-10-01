// An offer link from an availability request (`/property/<id>?inq=<request>`,
// SPEC §11) - remembered per listing for the session, so it survives the
// sign-in detour, and sent with the viewing request so the two are linked.
const INQ_KEY = 'hausto.offer-inquiry';

export function rememberOfferInquiry(listingId: string, inquiryId: string | null): void {
  if (!inquiryId || !/^[0-9a-f-]{36}$/i.test(inquiryId)) return;
  try { sessionStorage.setItem(`${INQ_KEY}:${listingId}`, inquiryId); } catch { /* private mode */ }
}

export function offerInquiryFor(listingId: string): string | null {
  try { return sessionStorage.getItem(`${INQ_KEY}:${listingId}`); } catch { return null; }
}
