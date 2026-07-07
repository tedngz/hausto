# Vibe Matching v2 — Implementation Spec

Status: **in progress**. Owner decisions are locked (see §10).

## 0. Design principles
- **Score only on data we actually have.** Every scored dimension must trace to a real field, not a hardcoded guess.
- **One feature vocabulary, two consumers.** The client `vibeScoring` (on-card %) and the server `chat-ai` ranker read the same canonical feature set so they can't contradict.
- **No image re-analysis in v2.** Everything is derivable from existing `vibe_analysis` metrics, `amenities`, `highlights`, and `description`. Furniture-style capture is out of scope (needs re-analysis; deferred — see §9).

## 1. What data each property actually has
From `analyze-vibe/shared.ts` (the AI image analyzer), per listing:
- **10 numeric aesthetic scores (1–10):** `modern, cozy, luxurious, minimalist, colorful, spacious, natural_light, urban, rustic, elegant` — averaged across images. Strong, on every property.
- **`amenities[]`** — granular, mixes furniture + features (`Balcony, Large Windows, Sofa, Electric Cooktop, AC`).
- **`highlights[]` + `detailed_analysis`** — per-image prose.
- **`suggested_activities[]`** (Working/Reading/Relaxing/Entertaining/Cooking/Exercising) — per-image, **was never aggregated to top level** (fixed in §3).
- **`styles[]`/`colors[]`/`activities[]`** — only present if a realtor typed them; usually absent on AI-analyzed listings.

The DB dump confirms concrete signals are everywhere but unscored: balcony (~2,600 mentions), garden/greenery (~2,900), pool, gym, river/city view.

## 2. Canonical property feature set
Add a derived `features` object to `vibe_analysis` (JSON — no column migration on properties):

```ts
// vibe_analysis.features
{
  balcony: boolean,
  view: 'river' | 'city' | 'sea' | 'park' | null,
  greenery: boolean,        // garden / park / plants
  pool: boolean,
  gym: boolean,
  natural_light: boolean,   // metric >= 7 OR light keywords
  spacious: boolean,        // metric >= 7 OR "open-plan"/"spacious"
  furnished: boolean,       // >= 2 furniture amenities (reuse existing logic)
  kitchen_ready: boolean,   // cooktop/hood/oven/cabinets
  workspace: boolean,       // desk/study/workspace
  quiet: boolean            // quiet/peaceful/serene
}
```

### Extraction rules (`src/lib/propertyFeatures.ts`, mirrored in `supabase/functions/_shared/property-features.ts`)
Haystack = `amenities ∪ highlights ∪ description ∪ title`, lowercased. Keyword lists defined once per side and kept identical.

| Feature | Rule |
|---|---|
| `balcony` | balcony, terrace, loggia |
| `view` | river/riverside→river, city/skyline→city, sea/ocean→sea, park→park (first match) |
| `greenery` | garden, greenery, park, trees, plants, green space |
| `pool` | pool, swimming pool |
| `gym` | gym, fitness |
| `natural_light` | metric `natural_light >= 7` OR floor-to-ceiling / large windows / bright / sunlit |
| `spacious` | metric `spacious >= 7` OR spacious / open-plan |
| `furnished` | >= 2 furniture amenities OR "fully furnished" |
| `kitchen_ready` | Kitchen Cabinets / Electric Cooktop / Ventilation Hood / Oven / Stove |
| `workspace` | desk / study / workspace / home office |
| `quiet` | quiet / peaceful / serene |

## 3. analyze-vibe changes
After `aggregated` is built:
```ts
const acts = new Set<string>();
analyses.forEach(a => (a.suggested_activities || []).forEach(x => acts.add(x)));
aggregated.activities = Array.from(acts);
aggregated.features = extractPropertyFeatures({ metrics: aggregated, amenities, highlights, description });
```

## 4. Backfill (no LLM cost)
`backfill-property-features` (or a flag on `batch-reanalyze-properties`) recomputes `features` + aggregated `activities` from **already-stored** data for `properties` and `external_properties`. Pure text/metric derivation — no image calls.

## 5. Quiz changes
### 5a. New DISTINCT must-haves step (decision: distinct step)
Copy: **"Any deal-breakers? Pick what a place must have."**
Options (id = feature key): Balcony · Natural light · Greenery/park · River or city view · Pool · Gym · Quiet · Furnished · Home workspace.

### 5b. Lifestyle step stays, but is repointed to soft features
Lifestyle no longer scores directly; each answer expands a set of **soft desired features**:

| Lifestyle | Soft features |
|---|---|
| Working | workspace, natural_light, quiet |
| Reading | natural_light, quiet |
| Relaxing | balcony, greenery, natural_light, view |
| Entertaining | spacious, balcony, kitchen_ready |
| Cooking | kitchen_ready |
| Exercising | gym |

Net quiz = 7 steps: Style · **Must-haves (new)** · Lifestyle · Budget · Size · Location · Move-in.

### 5c. Storage (decision: new column)
- `user_preferences.must_haves text[]` (nullable) — new migration.
- `UserPreferences.mustHaves: string[]`.
- `preferencesToDb` / `dbToPreferences` / `preferencesToSearchQuery` updated (must-haves render as "must have a balcony and river view" in the seeded opening message).

## 6. Client scoring rewrite (`vibeScoring.ts`)
```
overall = style    * 0.30   // aesthetic taste vs numeric metrics
        + features * 0.35   // must-haves + soft(lifestyle) vs vibe_analysis.features
        + location * 0.20
        + price    * 0.15
```
Lifestyle is folded into features (no separate fake-fallback dimension).

**Feature sub-score + HARD CAP (decision: hard cap):**
- `mustMatched / |mustHaves|` drives the base.
- Soft (lifestyle) features add partial credit.
- **If any hard must-have is unmet:** `featureScore <= 40` AND `overall <= 60`, and the property is flagged `missingMustHave`.
- Popover shows a **Features** row with matched/unmatched chips (Balcony ✓, River view ✗), replacing the old color swatches.

## 7. Server ranker alignment (`chat-ai`) — stays SOFT & explorable
Decision: hard cap applies to the **displayed match grade only**. The chat ranker must never eliminate a property for a missing quiz must-have, so users can always explore outside their preferences.
- Seed quiz `mustHaves` into `accContext.amenities` — this reuses the existing **boost-only** amenity text match (+10 each, never `continue`/skip). Results are never filtered out on must-haves.
- Current-message parsing still runs after the seed, so an explicit different request overrides the saved must-haves (per existing out-of-preference handling).
- Add matched must-haves to `matchReasons` ("has balcony, river view").
- The renter-profile prompt block lists must-haves as strong-but-overridable preferences.

## 8. UI surfaces
- `VibeScore.tsx` / `VibeScoreBar.tsx`: Features row (matched/unmatched chips) replacing Color.
- `EditorialPropertyCard.tsx`: `VibeMatchAttributes` gains `features`.
- `PreferencesEditModal.tsx` / `Profile.tsx` / `RenterProfileModal.tsx`: show + edit must-haves.

## 9. Deferred (Stage 2 — needs re-analysis)
- **Furniture style** (rattan / mid-century / wood-tone) and **greenery type** (indoor plants vs park view): require a new field in the `analyze-vibe` prompt and a re-run over the library. Revisit only after v2 proves the direction.

## 10. Locked decisions
- **Storage:** new `user_preferences.must_haves text[]` column (not reusing amenities).
- **Quiz:** must-haves is a **distinct** step (7 steps total).
- **Scoring:** **hard cap** the displayed match grade when a must-have is unmet (feature ≤ 40, overall ≤ 60); the **chat-ai ranker stays soft** (boost-only) so exploring outside preferences still returns results.

## 11. Sequencing (each independently shippable)
1. `propertyFeatures.ts` + Deno `_shared/property-features.ts` (pure, testable).
2. `analyze-vibe` aggregation (activities + features).
3. Backfill existing library.
4. Migration + prefs plumbing (`must_haves`, `mustHaves`).
5. Quiz must-haves step + edit/display surfaces.
6. `vibeScoring` rewrite + UI feature chips.
7. `chat-ai` soft seed of must-haves.

Stages 1–4 are invisible until 5–7 land, so they can merge first.
