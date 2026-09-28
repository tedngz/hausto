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

export function renderIntakeAlert(opts: {
  ref: string;
  placeCount: number;
  /** Set when places joined a request that was already open. */
  added?: number;
  availability: { date: string; part: string }[];
  createdAt: Date;
}): IntakeAlert {
  const local = new Date(opts.createdAt.getTime() + 7 * 60 * 60 * 1000).toISOString();
  const at = `${local.slice(11, 16)} on ${local.slice(0, 10)}`;
  const windows = opts.availability.map(w => `${w.date} ${w.part.toLowerCase()}`).join(', ') || 'not stated';
  const places = `${opts.placeCount} place${opts.placeCount === 1 ? '' : 's'}`;
  if (opts.added) {
    const more = `${opts.added} more place${opts.added === 1 ? '' : 's'}`;
    return {
      subject: `${opts.ref} - ${more} added, ${places} now`,
      text: [
        `The renter on ${opts.ref} asked for ${more} at ${at} (Ho Chi Minh City). It joins the same plan: ${places} now.`,
        `Same times as before: ${windows}.`,
        '',
        'The new agent has not been contacted yet. The itinerary waits until they answer.',
        '',
        `Open the queue: ${CONSOLE_URL}`,
      ].join('\n'),
    };
  }
  return {
    subject: `New viewing request ${opts.ref} - ${places}`,
    text: [
      `${opts.ref} came in at ${at} (Ho Chi Minh City) for ${places}.`,
      `Renter is free: ${windows}.`,
      '',
      'The renter has been promised news within 24 hours of now. The agents are the slow part - contact them first.',
      '',
      `Open the queue: ${CONSOLE_URL}`,
    ].join('\n'),
  };
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
