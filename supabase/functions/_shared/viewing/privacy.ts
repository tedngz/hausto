// Invariant 4 for free text: the renter's contact never reaches a broker, and a
// broker's never reaches the renter.
//
// Templates keep both out by shape - the renter DTO has no realtor field, the
// broker drafts take no renter field. Free text is where that stops holding: an
// operator editing a draft or answering a renter can paste a number from the
// wrong window. So every free-text body crossing the line is checked here on
// the way out, by the server, whatever the console did.

/**
 * A Vietnamese mobile number in any of the shapes a person types one:
 * `0901234567`, `+84 90 123 45 67`, `84.90.123.4567`. Anchored against digits
 * on both sides so a longer run - a price, a listing id - does not match part
 * of itself. `ops_request_thread()` masks with the same pattern.
 */
const PHONE_SHAPED = /(?<!\d)(?:\+?84|0)[\s.-]?[35789](?:[\s.-]?\d){8}(?!\d)/;

/**
 * Any number written with a country code - `+44 7700 900123`,
 * `0044 7700 900123`. Renters can be on any country's number now, so a
 * renter's number written the international way has to be caught too. Not
 * after a `.` or `,`: that `00` is the middle of a price (`12.005.500.000`).
 * `public.mask_phone_numbers()` masks with the same pattern.
 */
const INTERNATIONAL_SHAPED = /(?<![\d.,])(?:\+|00)[1-9](?:[\s.-]?\d){6,14}(?!\d)/;

/** URLs carry listing ids that can look like anything, and are ours anyway. */
const URL = /https?:\/\/\S+/g;

/**
 * True when the text carries anything that reads as a Vietnamese phone number.
 * What renter-bound free text is checked for: agents are Vietnamese.
 */
export function containsPhoneNumber(text: string): boolean {
  return PHONE_SHAPED.test(String(text ?? '').replace(URL, ' '));
}

/**
 * True when the text carries a number of any country, written with its code.
 * Agent-bound free text is checked for this as well, since that is the
 * direction a foreign renter's number could leak.
 */
export function containsInternationalNumber(text: string): boolean {
  return INTERNATIONAL_SHAPED.test(String(text ?? '').replace(URL, ' '));
}
