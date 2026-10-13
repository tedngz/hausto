// Telling an operator a request has arrived (gap 10 in the AI operator plan).
//
// Before this, a request filed at 11pm waited until someone happened to open
// the console tab. The 24-hour promise (SPEC §9) starts at intake, so every
// hour it sits unseen is an hour off the operator's clock - and the first
// broker call is the step that takes longest.
//
// Email, to everyone holding the `ops` role, because that is who works the
// queue and it needs no new configuration: a new operator gets alerts the
// moment they get the role. It carries the ref and nothing about the renter -
// the console is where the request is worked, and an inbox is a worse place
// for a renter's details than a screen that cannot show them at all.

// deno-lint-ignore no-explicit-any
type Supa = any;

export const CONSOLE_URL = 'https://hausto-ops.vercel.app';

export interface IntakeAlert {
  subject: string;
  text: string;
}

/**
 * A requested place with no agent number. Nobody can be asked about it until
 * someone finds one, so the alert puts it first: open the listing, press its
 * show-number button, save the number on the request in the console.
 */
export interface MissingContact {
  title: string;
  url: string | null;
  /** The masked number the listing shows ("0931 277 ***"), when it shows one. */
  shows: string | null;
}

export function renderIntakeAlert(opts: {
  ref: string;
  placeCount: number;
  /** Set when places joined a request that was already open. */
  added?: number;
  availability: { date: string; part: string }[];
  /** When the renter expects to move in, if they said. */
  moveInDate?: string | null;
  createdAt: Date;
  /** The places just asked for that have no agent number. */
  missingContact?: MissingContact[];
  /** Times the renter added as the places joined (intake.ts extendAvailability). */
  addedWindows?: { date: string; part: string }[];
}): IntakeAlert {
  const local = new Date(opts.createdAt.getTime() + 7 * 60 * 60 * 1000).toISOString();
  const at = `${local.slice(11, 16)} on ${local.slice(0, 10)}`;
  const windows = opts.availability.map(w => `${w.date} ${w.part.toLowerCase()}`).join(', ') || 'not stated';
  const places = `${opts.placeCount} place${opts.placeCount === 1 ? '' : 's'}`;
  const missing = opts.missingContact ?? [];
  const flag = missing.length ? ` - ${missing.length} with no agent number` : '';
  const findFirst = missing.length
    ? [
      '',
      `No agent number for ${missing.length === 1 ? 'this place' : `these ${missing.length} places`}, so nobody can be asked yet. ` +
        'Open each, press its show-number button, and save the number on the request in the console:',
      ...missing.map(m => `- ${m.title}${m.shows ? ` (shows ${m.shows})` : ''}: ${m.url ?? 'no link on file'}`),
    ]
    : [];
  if (opts.added) {
    const more = `${opts.added} more place${opts.added === 1 ? '' : 's'}`;
    return {
      subject: `${opts.ref} - ${more} added, ${places} now${flag}`,
      text: [
        `The renter on ${opts.ref} asked for ${more} at ${at} (Ho Chi Minh City). It joins the same plan: ${places} now.`,
        opts.addedWindows?.length
          ? `With ${opts.addedWindows.length === 1 ? 'a new time' : 'new times'}: ${opts.addedWindows.map(w => `${w.date} ${w.part.toLowerCase()}`).join(', ')}. All times now: ${windows}. Agents already asked keep the times they were asked about; ask the new one about all of them.`
          : `Same times as before: ${windows}.`,
        '',
        'The new agent has not been contacted yet. The itinerary waits until they answer.',
        ...findFirst,
        '',
        `Open the queue: ${CONSOLE_URL}`,
      ].join('\n'),
    };
  }
  return {
    subject: `New viewing request ${opts.ref} - ${places}${flag}`,
    text: [
      `${opts.ref} came in at ${at} (Ho Chi Minh City) for ${places}.`,
      `Renter is free: ${windows}.`,
      ...(opts.moveInDate ? [`Expects to move in: ${opts.moveInDate}.`] : []),
      '',
      'The renter has been promised news within 24 hours of now. The agents are the slow part - contact them first.',
      ...findFirst,
      '',
      `Open the queue: ${CONSOLE_URL}`,
    ].join('\n'),
  };
}

/**
 * The listings behind requested places that have no agent, for the alert.
 * Read separately from intake's candidate columns, which stay narrow on
 * purpose. Never throws: on a failed read the places are still flagged, just
 * without their titles and links.
 */
export async function missingContactsFor(db: Supa, listingIds: string[]): Promise<MissingContact[]> {
  if (listingIds.length === 0) return [];
  let rows: { id: string; title: string | null; source_url: string | null; contact_phone: string | null }[] = [];
  try {
    const { data } = await db.from('external_properties').select('id, title, source_url, contact_phone').in('id', listingIds);
    rows = data ?? [];
  } catch (e) {
    console.error('[ops-alert] missing-contact lookup failed:', (e as Error).message);
  }
  return listingIds.map(id => {
    const r = rows.find(x => x.id === id);
    const phone = r?.contact_phone?.trim() ?? '';
    return { title: r?.title?.trim() || 'A listing', url: r?.source_url ?? null, shows: phone.includes('*') ? phone : null };
  });
}

/** Email addresses of everyone with the ops role. Service role only - it reads auth users. */
export async function opsAlertRecipients(db: Supa): Promise<string[]> {
  const { data: roles } = await db.from('user_roles').select('user_id').eq('role', 'ops');
  const emails: string[] = [];
  for (const r of (roles ?? []) as { user_id: string }[]) {
    const { data } = await db.auth.admin.getUserById(r.user_id);
    const email = data?.user?.email;
    if (email && !emails.includes(email)) emails.push(email);
  }
  return emails;
}

/**
 * Send it. Never throws: a request the renter has already paid for must not
 * fail because an email did, so every failure is logged and swallowed.
 */
export async function sendIntakeAlert(
  db: Supa,
  alert: IntakeAlert,
  resendApiKey: string | undefined,
): Promise<{ sent: number; skipped?: string }> {
  try {
    if (!resendApiKey) return { sent: 0, skipped: 'RESEND_API_KEY not set' };
    const to = await opsAlertRecipients(db);
    if (to.length === 0) return { sent: 0, skipped: 'nobody has the ops role' };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Hausto <hello@hausto.com>', to, subject: alert.subject, text: alert.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('[ops-alert] resend refused:', res.status, (await res.text()).slice(0, 300));
      return { sent: 0, skipped: `resend ${res.status}` };
    }
    return { sent: to.length };
  } catch (e) {
    console.error('[ops-alert] failed:', (e as Error).message);
    return { sent: 0, skipped: (e as Error).message };
  }
}
