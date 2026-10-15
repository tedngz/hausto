// How often a cron expression fires, in minutes - for the admin page's "one
// full rotation", which is the number of combos divided by how many rotation
// runs start per hour. Every trigger pointed at scheduled-crawl starts one, so
// the page needs all of them, not just pg_cron's.
//
// Only the regular shapes a crawl schedule actually uses are understood. A
// schedule that fires unevenly (weekdays only, a list of hours) returns null,
// and the page shows it without pretending to know its rate.

/** Minutes between firings of a five-field cron expression, or null when it
 *  does not fire at a steady rate. A QStash `CRON_TZ=...` prefix is ignored. */
export function cronEveryMinutes(cron: string): number | null {
  const fields = cron.trim().replace(/^CRON_TZ=\S+\s+/, '').split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields;
  if (dom !== '*' || month !== '*' || dow !== '*') return null;

  const perHour = firingsPerHour(minute);
  if (perHour === null) return null;
  if (hour === '*') return 60 / perHour;
  // Once in every H hours: `0 */H * * *`.
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours && perHour === 1) {
    const h = Number(everyHours[1]);
    return h > 0 && 24 % h === 0 ? h * 60 : null;
  }
  return null;
}

function firingsPerHour(minute: string): number | null {
  if (minute === '*') return 60;
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step) {
    const n = Number(step[1]);
    return n > 0 && 60 % n === 0 ? 60 / n : null;
  }
  if (/^\d+$/.test(minute)) return 1;
  // `0,30` or `7,37`: steady only if the gaps are equal.
  if (/^\d+(,\d+)+$/.test(minute)) {
    const at = minute.split(',').map(Number).sort((a, b) => a - b);
    const gap = 60 / at.length;
    return at.every((m, i) => i === 0 || m - at[i - 1] === gap) ? at.length : null;
  }
  return null;
}
