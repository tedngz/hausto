// Display conventions (SPEC §7), in one place.
//
// These were written twice before this file existed - once in intake.ts and
// once in triage.ts - which is exactly how two surfaces end up disagreeing
// about what a price looks like. Money and time are the two things a renter
// checks against something else they were told, so they are the two that must
// not drift.

/** `15.000.000 ₫`. Dong is an integer; never format a float. */
export function formatVnd(dong: number): string {
  return `${Math.round(dong).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

/** Stored UTC, displayed Asia/Ho_Chi_Minh. Always both. */
export function hcmc(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** `Sat 12 Sep, 14:00` - what an itinerary line needs to read like. */
export function hcmcLong(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** `14:00` on its own, for a second stop on a day already named. */
export function hcmcTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit',
  });
}

/** The local calendar date in Asia/Ho_Chi_Minh. UTC+7, no DST. */
export function hcmcDate(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function humanAge(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  if (h < 1) return `${Math.floor(seconds / 60)}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
