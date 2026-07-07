// Deno mirror of src/lib/propertyFeatures.ts (extraction half only).
// Used by analyze-vibe (new listings) and the features backfill.
// KEEP THE KEYWORD RULES IDENTICAL to the client module.

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

interface ExtractInput {
  metrics?: Record<string, unknown> | null;
  amenities?: unknown;
  highlights?: unknown;
  description?: string | null;
  title?: string | null;
}

const toArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function extractPropertyFeatures(input: ExtractInput): PropertyFeatures {
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
}
