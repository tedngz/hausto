## Goal
Let the Discover AI chat answer questions precisely with the right response shape. Today it always returns a `{summary, results[], totalMatches}` blob, so questions like "tell me about Masteri Thao Dien", "what's District 2 like?", "how far is Thao Dien from D1?", or "should I pick a serviced apartment or a regular lease?" all get squeezed into the listing-card UI. We want the AI to pick the right block(s): complex profile, district quick-facts, distance/commute, plain advice — and still return listing cards when the user is actually shopping.

## What the AI returns (new response schema)

Replace the single-shape JSON with a `blocks` array. The edge function and the UI agree on a small set of block types; the AI picks 1–N per turn.

```ts
type AIBlock =
  | { type: 'text';       body: string }                                   // plain advice / answer
  | { type: 'listings';   summary: string; results: PropertyMatch[]; totalMatches: number }
  | { type: 'complex';    complexId?: string; name: string; city: string; district: string;
                          developer?: string; management?: string; yearCompleted?: number;
                          petPolicy?: string; amenities?: string[];
                          rentRanges?: { bedrooms: string; minUsd: number; maxUsd: number }[];
                          insiderNotes?: string; commute?: { to: string; minutes: number }[]; }
  | { type: 'district';   city: string; district: string; vibe: string;
                          bestFor: string[]; tradeoffs: string[];
                          priceIndexUsd?: { bedrooms: string; min: number; max: number }[];
                          notableComplexes?: string[]; }
  | { type: 'distance';   from: string; to: string; km?: number; driveMinutes?: number;
                          bikeMinutes?: number; notes?: string }
  | { type: 'followups';  suggestions: string[] };                          // chips under the answer

type AIResponse = { blocks: AIBlock[] };
```

A "shopping" turn returns `[{type:'text'}, {type:'listings'}, {type:'followups'}]`. A "tell me about X complex" turn returns `[{type:'complex'}, {type:'followups'}]`. Mixed turns are allowed (e.g. district block + 2 listings + followups).

## Edge function changes (`supabase/functions/chat-ai/index.ts`, renter mode)

1. **Intent classification + block selection in the system prompt.** Extend the renter system prompt to teach the model:
   - Decide intent: `shopping | complex_info | district_info | distance | advice | mixed`.
   - For each intent, which blocks to emit and in what order.
   - Listings are required only for `shopping` / `mixed`. For pure info questions, do **not** force property cards.
   - All blocks must be inside a single top-level `{"blocks":[...]}` JSON object, prose still streams first then the JSON block last (keeps existing TTFT pattern from `.lovable/plan.md`).
2. **Ground the info blocks with real project data** so the model doesn't hallucinate:
   - Pull from existing `complexes` table (already queried in `useComplexes`) when the user names or implies a complex — pass top 3 matches as `KNOWN_COMPLEXES` context lines.
   - Pull from `src/data/locationDescriptions.ts` for district/ward facts — surface them as `KNOWN_DISTRICTS` context lines.
   - Pull a short `KNOWN_DISTANCES` table for the common HCM/Hanoi neighborhood pairs (Thao Dien↔D1, Phu My Hung↔D1, Tay Ho↔Hoan Kiem, etc.) — small static map in the edge function.
   - The prompt instruction: "Only use fields you can support from the provided KNOWN_* context or the user's prior messages. Omit fields you don't know. Never invent prices, year built, or commute times."
3. **Validation + fallback.** After parsing:
   - Keep existing `validateAndFixAIResults` for any `listings` block.
   - For other blocks, drop unknown fields, clip strings, and ensure required keys exist; otherwise downgrade to a `text` block carrying the AI's prose so the UI never breaks.
   - If parsing fails entirely, return a single `text` block with the accumulated prose (today's fallback already has the prose).
4. **Persistence.** Save the assistant message exactly as today (full text incl. JSON) so `HomeAI` can re-parse on history reload.

## Client changes

### `src/hooks/useHomeAI.tsx`
- No API change. Continue to return the assistant text. The component is responsible for parsing `blocks`.

### `src/components/HomeAI.tsx`
- Replace the single "summary + property cards" render path with a `<AIBlocks blocks={...} />` renderer.
- Parsing helper: try `JSON.parse` for `{blocks:[...]}`; if it fails, fall back to the legacy `{results,summary,totalMatches}` shape and wrap as `[{type:'listings', ...}]` so existing history keeps rendering.
- Apply parsing in both the live-stream render path and the persisted-history render path (both already exist around lines 483 and 616).

### New components (small, presentational, all in `src/components/ai-blocks/`)
- `TextBlock.tsx` — markdown-lite prose bubble (reuse existing bubble styles).
- `ListingsBlock.tsx` — extract today's property-cards grid out of `HomeAI.tsx` 1:1, no behavior change (click → `PropertyDetailModal`, like, schedule).
- `ComplexBlock.tsx` — header (name, district, developer/management), chips for amenities, a compact rent-range table, pet policy line, insider notes, commute list. CTA "See listings in this complex" → re-asks the AI with a templated follow-up.
- `DistrictBlock.tsx` — district name, vibe sentence, best-for / tradeoffs as two bullet columns, optional price index table, notable complexes as clickable chips (each chip re-asks the AI for that complex).
- `DistanceBlock.tsx` — "From → To", km, drive/bike minutes, notes. Pure presentational.
- `FollowupsBlock.tsx` — pill buttons; clicking sends the suggestion as the next user message via the existing `sendMessageWithoutConversation` path.

All components use semantic Tailwind tokens (`bg-card`, `text-foreground`, `border-border`, accent for chips) — no hardcoded colors, matches existing design system.

## Out of scope
- No new tables. We're reading from `complexes` + `locationDescriptions.ts` only.
- No map rendering inside `DistanceBlock` (text-only); a map view can come later.
- Realtor-mode (`hausto-ai-assist`) unchanged.
- Onboarding/quiz, matches, profile — untouched.

## Files touched
- `supabase/functions/chat-ai/index.ts` — new system prompt, KNOWN_* context injection, parse/validate blocks, fallback.
- `src/components/HomeAI.tsx` — swap render path to `AIBlocks`, keep legacy parser for old messages.
- `src/components/ai-blocks/{TextBlock,ListingsBlock,ComplexBlock,DistrictBlock,DistanceBlock,FollowupsBlock,AIBlocks}.tsx` — new.
- (optional) `supabase/functions/chat-ai/distances.ts` — static HCM/Hanoi neighborhood distance table imported by the edge function.

## Risk / rollout
- Backwards compatible: legacy `{results,summary}` messages still render via the fallback parser.
- New block types are additive; an unknown `type` from the model is rendered as a `TextBlock` carrying its JSON-as-text so nothing crashes.
- One round of manual QA per intent (shopping, complex, district, distance, advice, mixed) before calling it done.
