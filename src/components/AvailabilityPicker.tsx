import { useMemo } from 'react';
import { Sun, Sunrise, Sunset } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DAY_PARTS,
  MAX_DAYS_AHEAD,
  MIN_LEAD_DAYS,
  addDays,
  hcmcDate,
  type AvailabilityWindow,
  type DayPart,
} from '../../supabase/functions/_shared/viewing/intake.ts';

/** intake.ts validateAvailability refuses a seventh. */
export const MAX_WINDOWS = 6;

export const PART_LABEL: Record<DayPart, string> = {
  MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening',
};
const PART_ICON: Record<DayPart, typeof Sun> = {
  MORNING: Sunrise, AFTERNOON: Sun, EVENING: Sunset,
};

export function partsOf(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    day: d.toLocaleDateString('en-GB', { day: 'numeric' }),
    month: d.toLocaleDateString('en-GB', { month: 'short' }),
  };
}

/** `Sat 17 Oct`. */
export function prettyDate(iso: string): string {
  const p = partsOf(iso);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** The days the renter may pick: from MIN_LEAD_DAYS out to MAX_DAYS_AHEAD, in Ho Chi Minh City. */
export function useOfferableDays(): { today: string; earliest: string; days: string[] } {
  const today = hcmcDate(new Date());
  return useMemo(() => {
    const days: string[] = [];
    for (let i = MIN_LEAD_DAYS; i <= MAX_DAYS_AHEAD; i++) days.push(addDays(today, i));
    return { today, earliest: addDays(today, MIN_LEAD_DAYS), days };
  }, [today]);
}

/**
 * Days, then a time of day for each - chips, not a clock, because what time on
 * Tuesday is the agent's to answer (SPEC §1). The request modal and the
 * Viewings tab's "Change times" both use it, so the two cannot offer different
 * windows; the server checks them again either way (validateAvailability).
 */
export function AvailabilityPicker({ value, onChange, taken = [], max = MAX_WINDOWS }: {
  value: AvailabilityWindow[];
  onChange: (next: AvailabilityWindow[]) => void;
  /** Times the request already has, shown as chosen and not pickable again. */
  taken?: AvailabilityWindow[];
  /** How many may be picked here - fewer when adding to a request's times. */
  max?: number;
}) {
  const { days } = useOfferableDays();
  const chosenDates = useMemo(() => [...new Set(value.map(w => w.date))].sort(), [value]);
  const isTaken = (date: string, part: DayPart) => taken.some(w => w.date === date && w.part === part);
  const tooMany = () => toast.error(max === MAX_WINDOWS
    ? `Pick up to ${MAX_WINDOWS} time windows.`
    : `Your request can take ${max} more time${max === 1 ? '' : 's'}.`);

  const toggleDay = (date: string) => {
    if (value.some(w => w.date === date)) return onChange(value.filter(w => w.date !== date));
    const part = DAY_PARTS.find(p => !isTaken(date, p));
    if (!part) return;
    if (value.length >= max) return tooMany();
    onChange([...value, { date, part }]);
  };

  const toggleWindow = (date: string, part: DayPart) => {
    const exists = value.some(w => w.date === date && w.part === part);
    // Removing the last part of a day removes the day: an operator cannot act
    // on "Saturday, no times".
    if (exists) return onChange(value.filter(w => !(w.date === date && w.part === part)));
    if (isTaken(date, part)) return;
    if (value.length >= max) return tooMany();
    onChange([...value, { date, part }]);
  };

  return (
    <>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
        {days.map(date => {
          const p = partsOf(date);
          const on = chosenDates.includes(date);
          const full = DAY_PARTS.every(part => isTaken(date, part));
          const some = !on && taken.some(w => w.date === date);
          return (
            <button
              key={date}
              type="button"
              onClick={() => toggleDay(date)}
              aria-pressed={on}
              disabled={full}
              className={cn(
                'flex flex-col items-center rounded-md border px-1 py-1.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                on ? 'border-primary bg-primary text-primary-foreground' : some ? 'border-primary/40 bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted',
              )}
            >
              <span className="text-[10px] uppercase opacity-80">{p.weekday}</span>
              <span className="text-sm font-semibold leading-tight">{p.day}</span>
              <span className="text-[10px] opacity-80">{p.month}</span>
            </button>
          );
        })}
      </div>

      {chosenDates.length > 0 && (
        <ul className="mt-3 space-y-2">
          {chosenDates.map(date => (
            <li key={date} className="rounded-md border p-2">
              <div className="mb-1.5 text-sm font-medium">{prettyDate(date)}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {DAY_PARTS.map(part => {
                  const on = value.some(w => w.date === date && w.part === part);
                  const already = isTaken(date, part);
                  const Icon = PART_ICON[part];
                  return (
                    <button
                      key={part}
                      type="button"
                      aria-pressed={on || already}
                      disabled={already}
                      onClick={() => toggleWindow(date, part)}
                      className={cn(
                        'flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px] transition-colors',
                        on ? 'border-primary bg-primary text-primary-foreground'
                          : already ? 'cursor-not-allowed border-primary/40 bg-primary/10 text-primary' : 'hover:bg-muted',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {already ? 'Already in' : PART_LABEL[part]}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
