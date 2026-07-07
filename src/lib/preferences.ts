import { UserPreferences } from '@/types';
import { mustHavesToPhrase } from '@/lib/propertyFeatures';

/**
 * Single source of truth for renter preferences.
 *
 * Preferences live in two shapes:
 *  - DB (`user_preferences` table): snake_case columns, budget split into min/max.
 *  - UI (`UserPreferences`): camelCase, budget as a [min, max] tuple.
 *
 * The quiz, the profile editor, Discover, and the chat pipeline all go through
 * these helpers so the mapping and the natural-language query stay consistent.
 */

export interface UserPreferencesRow {
  user_id: string;
  styles: string[] | null;
  activities: string[] | null;
  must_haves: string[] | null;
  price_range_min: number | null;
  price_range_max: number | null;
  size: string | null;
  location: string[] | null;
  move_in_date: string | null;
  updated_at?: string;
}

const DEFAULT_PRICE_RANGE: [number, number] = [8000000, 15000000];

/** Normalize the legacy `size` field, which was sometimes stored as an array. */
export const normalizeSize = (size: unknown): string => {
  if (Array.isArray(size)) return (size[0] as string) || '';
  return (size as string) || '';
};

export const dbToPreferences = (row: UserPreferencesRow | null | undefined): UserPreferences | null => {
  if (!row) return null;
  return {
    styles: row.styles ?? [],
    activities: row.activities ?? [],
    mustHaves: row.must_haves ?? [],
    priceRange: [
      row.price_range_min ?? DEFAULT_PRICE_RANGE[0],
      row.price_range_max ?? DEFAULT_PRICE_RANGE[1],
    ],
    size: normalizeSize(row.size),
    location: row.location ?? [],
    moveInDate: row.move_in_date ?? '',
  };
};

export const preferencesToDb = (
  prefs: UserPreferences,
  userId: string,
): UserPreferencesRow => ({
  user_id: userId,
  styles: prefs.styles ?? [],
  activities: prefs.activities ?? [],
  must_haves: prefs.mustHaves ?? [],
  price_range_min: prefs.priceRange?.[0] ?? DEFAULT_PRICE_RANGE[0],
  price_range_max: prefs.priceRange?.[1] ?? DEFAULT_PRICE_RANGE[1],
  size: normalizeSize(prefs.size),
  location: prefs.location ?? [],
  move_in_date: prefs.moveInDate ?? '',
  updated_at: new Date().toISOString(),
});

// ---------- Human-readable labels ----------

const SIZE_PHRASES: Record<string, string> = {
  studio: 'studio',
  '1br': '1-bedroom',
  '2br': '2-bedroom',
  '3br+': '3+ bedroom',
};

const MOVE_IN_PHRASES: Record<string, string> = {
  asap: 'as soon as possible',
  '1month': 'within a month',
  '3months': 'within the next 3 months',
  '6months': 'in 6+ months',
};

const ACTIVITY_PHRASES: Record<string, string> = {
  Working: 'working from home',
  Reading: 'reading',
  Relaxing: 'relaxing',
  Entertaining: 'entertaining guests',
  Cooking: 'cooking',
  Exercising: 'exercising',
};

const formatMillions = (vnd: number): string => {
  const millions = vnd / 1_000_000;
  return Number.isInteger(millions) ? `${millions}` : millions.toFixed(1);
};

/**
 * Turn saved preferences into a first-person search message. This becomes the
 * renter's opening chat message after onboarding, so the AI search is driven by
 * the same pipeline as a typed request (city/budget/size get parsed as usual).
 */
export const preferencesToSearchQuery = (prefs: UserPreferences | null): string => {
  if (!prefs) return '';
  const parts: string[] = [];

  const styleText = (prefs.styles ?? []).slice(0, 3).join(', ').toLowerCase();
  const size = normalizeSize(prefs.size);
  const sizePhrase = SIZE_PHRASES[size] || '';

  let opening = "I'm looking for a";
  if (styleText) opening += ` ${styleText}`;
  if (sizePhrase) opening += ` ${sizePhrase}`;
  opening += ' apartment';

  const locations = (prefs.location ?? []).slice(0, 3);
  if (locations.length > 0) opening += ` in ${locations.join(' or ')}`;
  parts.push(opening + '.');

  const mustHavePhrase = mustHavesToPhrase(prefs.mustHaves);
  if (mustHavePhrase) parts.push(`It must have ${mustHavePhrase}.`);

  if (prefs.priceRange && prefs.priceRange.length === 2) {
    const [min, max] = prefs.priceRange;
    parts.push(
      `My budget is around ${formatMillions(min)}–${formatMillions(max)} million VND per month.`,
    );
  }

  const activities = (prefs.activities ?? [])
    .map((a) => ACTIVITY_PHRASES[a] || a.toLowerCase())
    .slice(0, 3);
  if (activities.length > 0) {
    parts.push(`At home I enjoy ${activities.join(', ')}.`);
  }

  const movePhrase = MOVE_IN_PHRASES[prefs.moveInDate];
  if (movePhrase) parts.push(`I'm hoping to move in ${movePhrase}.`);

  return parts.join(' ');
};

/** True when the renter has actually answered enough of the quiz to search. */
export const hasMeaningfulPreferences = (prefs: UserPreferences | null): boolean => {
  if (!prefs) return false;
  return (
    (prefs.styles?.length ?? 0) > 0 ||
    (prefs.location?.length ?? 0) > 0 ||
    (prefs.mustHaves?.length ?? 0) > 0 ||
    !!normalizeSize(prefs.size)
  );
};
