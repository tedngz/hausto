/**
 * Canonical property "feature" taxonomy for vibe matching v2.
 *
 * Features are concrete, renter-relevant attributes we can already extract from
 * existing data (amenities, highlights, description, and the numeric vibe metrics
 * produced by analyze-vibe). They power both the quiz "must-haves" step and the
 * vibe score's Features dimension.
 *
 * IMPORTANT: the keyword rules here MUST stay in sync with the Deno mirror at
 * supabase/functions/_shared/property-features.ts (used by analyze-vibe /
 * backfill). Keep the two lists identical.
 */

export type ViewType = 'river' | 'city' | 'sea' | 'park' | null;

export interface PropertyFeatures {
  balcony: boolean;
  view: ViewType;
  greenery: boolean;
  pool: boolean;
  gym: boolean;
  natural_light: boolean;
  spacious: boolean;
  furnished: boolean;
  kitchen_ready: boolean;
  workspace: boolean;
  quiet: boolean;
}

/** Boolean feature keys renters can require as must-haves (view handled specially). */
export type FeatureKey =
  | 'balcony'
  | 'view'
  | 'greenery'
  | 'pool'
  | 'gym'
  | 'natural_light'
  | 'spacious'
  | 'furnished'
  | 'kitchen_ready'
  | 'workspace'
  | 'quiet';

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  balcony: 'Balcony',
  view: 'River / city view',
  greenery: 'Greenery / park',
  pool: 'Pool',
  gym: 'Gym',
  natural_light: 'Natural light',
  spacious: 'Spacious',
  furnished: 'Furnished',
  kitchen_ready: 'Full kitchen',
  workspace: 'Home workspace',
  quiet: 'Quiet',
};

/** Options shown in the quiz "must-haves" step (order matters for display). */
export const MUST_HAVE_OPTIONS: { id: FeatureKey; label: string; emoji: string; description: string }[] = [
  { id: 'balcony', label: 'Balcony', emoji: '🌿', description: 'Outdoor space' },
  { id: 'natural_light', label: 'Natural light', emoji: '☀️', description: 'Bright & sunny' },
  { id: 'greenery', label: 'Greenery / park', emoji: '🌳', description: 'Nature nearby' },
  { id: 'view', label: 'River / city view', emoji: '🌆', description: 'A view to enjoy' },
  { id: 'pool', label: 'Pool', emoji: '🏊', description: 'Swimming access' },
  { id: 'gym', label: 'Gym', emoji: '🏋️', description: 'Fitness on-site' },
  { id: 'quiet', label: 'Quiet', emoji: '🤫', description: 'Peaceful & calm' },
  { id: 'furnished', label: 'Furnished', emoji: '🛋️', description: 'Move-in ready' },
  { id: 'workspace', label: 'Home workspace', emoji: '💻', description: 'Room to work' },
];

/**
 * Lifestyle answers (from the quiz activities step) → soft desired features.
 * These add partial credit but are never treated as hard must-haves.
 */
export const LIFESTYLE_FEATURE_MAP: Record<string, FeatureKey[]> = {
  Working: ['workspace', 'natural_light', 'quiet'],
  Reading: ['natural_light', 'quiet'],
  Relaxing: ['balcony', 'greenery', 'natural_light', 'view'],
  Entertaining: ['spacious', 'balcony', 'kitchen_ready'],
  Cooking: ['kitchen_ready'],
  Exercising: ['gym'],
};

// ---------- Extraction ----------

const KW = {
  balcony: ['balcony', 'terrace', 'loggia'],
  greenery: ['garden', 'greenery', 'park view', 'trees', 'plants', 'green space', 'greenspace'],
  pool: ['pool', 'swimming pool'],
  gym: ['gym', 'fitness'],
  natural_light: ['floor-to-ceiling', 'floor to ceiling', 'large windows', 'bright', 'sunlit', 'natural light', 'abundant light'],
  spacious: ['spacious', 'open-plan', 'open plan', 'expansive'],
  kitchen_ready: ['kitchen cabinet', 'cooktop', 'ventilation hood', 'range hood', 'oven', 'stove', 'gas hob', 'induction'],
  workspace: ['desk', 'study', 'workspace', 'home office', 'work station'],
  quiet: ['quiet', 'peaceful', 'serene', 'tranquil'],
  furnished: ['fully furnished', 'furnished'],
};

const FURNITURE_KEYWORDS = [
  'bed', 'sofa', 'couch', 'wardrobe', 'desk', 'table', 'dresser',
  'bookshelf', 'cabinet', 'chair', 'mattress', 'nightstand',
  'dining table', 'coffee table', 'tv stand', 'armchair',
];

const has = (haystack: string, words: string[]) => words.some((w) => haystack.includes(w));

const metricNum = (metrics: Record<string, unknown> | undefined, key: string): number => {
  const v = metrics?.[key];
  return typeof v === 'number' ? v : 0;
};

const detectView = (haystack: string): ViewType => {
  if (/river|riverside|riverfront/.test(haystack)) return 'river';
  if (/sea view|ocean|beachfront/.test(haystack)) return 'sea';
  if (/city view|skyline|cityscape/.test(haystack)) return 'city';
  if (/park view|park-side|parkside/.test(haystack)) return 'park';
  return null;
};

export interface ExtractInput {
  metrics?: Record<string, unknown> | null; // the numeric vibe_analysis object
  amenities?: unknown;
  highlights?: unknown;
  description?: string | null;
  title?: string | null;
}

const toArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Derive the canonical feature set from data we already store. Pure + deterministic. */
export const extractPropertyFeatures = (input: ExtractInput): PropertyFeatures => {
  const amenities = toArr(input.amenities);
  const highlights = toArr(input.highlights);
  const amenitiesLower = amenities.map((a) => a.toLowerCase());
  const haystack = [
    ...amenitiesLower,
    ...highlights.map((h) => h.toLowerCase()),
    (input.description || '').toLowerCase(),
    (input.title || '').toLowerCase(),
  ].join(' | ');

  const metrics = input.metrics || {};
  const furnitureCount = amenitiesLower.filter((a) =>
    FURNITURE_KEYWORDS.some((kw) => a.includes(kw)),
  ).length;

  return {
    balcony: has(haystack, KW.balcony),
    view: detectView(haystack),
    greenery: has(haystack, KW.greenery),
    pool: has(haystack, KW.pool),
    gym: has(haystack, KW.gym),
    natural_light: metricNum(metrics, 'natural_light') >= 7 || has(haystack, KW.natural_light),
    spacious: metricNum(metrics, 'spacious') >= 7 || has(haystack, KW.spacious),
    furnished: furnitureCount >= 2 || has(haystack, KW.furnished),
    kitchen_ready: has(haystack, KW.kitchen_ready),
    workspace: has(haystack, KW.workspace),
    quiet: has(haystack, KW.quiet),
  };
};

// ---------- Matching ----------

/** Does a property satisfy a single required feature key? */
export const propertyHasFeature = (
  features: PropertyFeatures | null | undefined,
  key: FeatureKey,
): boolean => {
  if (!features) return false;
  if (key === 'view') return features.view != null;
  return !!features[key];
};

export interface FeatureAttribute {
  key: FeatureKey;
  label: string;
  matched: boolean;
  required: boolean; // true = hard must-have, false = soft (lifestyle-derived)
}

/**
 * Build the matched/unmatched attribute list for the vibe popover, and report
 * whether any HARD must-have is unmet (drives the hard cap).
 */
export const getFeatureMatch = (
  features: PropertyFeatures | null | undefined,
  mustHaves: FeatureKey[],
  softFeatures: FeatureKey[],
): { attributes: FeatureAttribute[]; missingMustHave: boolean; mustMatched: number } => {
  const mustSet = new Set(mustHaves);
  const attributes: FeatureAttribute[] = [];
  let mustMatched = 0;
  let missingMustHave = false;

  for (const key of mustHaves) {
    const matched = propertyHasFeature(features, key);
    if (matched) mustMatched++;
    else missingMustHave = true;
    attributes.push({ key, label: FEATURE_LABELS[key], matched, required: true });
  }
  for (const key of softFeatures) {
    if (mustSet.has(key)) continue; // don't double-list
    attributes.push({
      key,
      label: FEATURE_LABELS[key],
      matched: propertyHasFeature(features, key),
      required: false,
    });
  }

  return { attributes, missingMustHave, mustMatched };
};

/** Expand quiz lifestyle answers into the soft feature set. */
export const lifestyleToSoftFeatures = (activities: string[] | undefined): FeatureKey[] => {
  const out = new Set<FeatureKey>();
  (activities ?? []).forEach((a) => {
    (LIFESTYLE_FEATURE_MAP[a] ?? []).forEach((f) => out.add(f));
  });
  return Array.from(out);
};

/** Human phrase for the seeded AI search message, e.g. "a balcony and a river view". */
export const mustHavesToPhrase = (mustHaves: string[] | undefined): string => {
  const labels = (mustHaves ?? [])
    .map((k) => FEATURE_LABELS[k as FeatureKey])
    .filter(Boolean)
    .map((l) => l.toLowerCase());
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
};
