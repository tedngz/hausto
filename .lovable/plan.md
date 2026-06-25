# Fix: Chat AI not returning property cards on listing queries

## Root cause

In `supabase/functions/_shared/lifestyle-kb.ts`, `detectLifestyleIntent` is too greedy. `LIFESTYLE_TRIGGERS` contains short generic words (`safe`, `safety`, `expat`, `schools`, `commute`, `cafe`, `walkable`, `transportation`, `pet friendly`, `vibe`, `tell me about`) that fire on perfectly normal shopping turns like "safe 2BR for expats near international school in D2". `SHOPPING_TRIGGERS` is narrow (mostly "show me / find me / under X"), so many real shopping phrasings ("apartment in Thao Dien", "rent in D7", "2 bedroom in An Phu") don't register as shopping.

Result: `isLifestyle=true` → `chat-ai/index.ts` line 2073 strips `topProperties` from the prompt AND line 2091 instructs the model "DO NOT return a results array". The model dutifully answers in prose, no cards.

Secondary: even on `isMixed` turns the model often follows the generic "INFO → blocks only" rule in section 2156, because nothing in the prompt forces it to include `results` when listings exist.

## Changes

### 1. `supabase/functions/_shared/lifestyle-kb.ts`

- Tighten `LIFESTYLE_TRIGGERS`: keep only multi-word phrases that unambiguously request info ("best place to live", "where should i live", "tell me about", "what is it like", "cost of living", "pros and cons", "vs", "versus", "recommend an area / district", "good for families/kids", "is it safe", "how safe", "food scene", "nightlife scene"). Drop bare words.
- Expand `SHOPPING_TRIGGERS` to cover natural listing phrasings: `apartment`, `apartments`, `flat`, `condo`, `studio`, `place to rent`, `for rent`, `rent in`, `rent a`, `any 2br/3br`, `something in`, `options in`, `units in`, `available in`.
- Add an override: if the message contains a clear apartment/listing keyword (`apartment`, `rent`, `studio`, `\d+\s*br`, `bedroom`), force `isLifestyle=false`. Mixed stays mixed.

### 2. `supabase/functions/chat-ai/index.ts`

- Around line 2073, keep `promptProperties` populated whenever `isMixed` OR shopping-keyword override is true (already covered by tighter detection, but add a belt-and-braces check on `topProperties.length > 0` and an explicit shopping-keyword regex).
- Around line 2091, add a new branch for `isMixed`: 

  > 🔀 MIXED TURN — answer the lifestyle question briefly in a `text` block AND include the matching listings in `results`. Both are required.

- In the JSON FORMAT section (≈line 2156), prepend a hard rule:

  > **DEFAULT TO SHOPPING.** If property candidates are provided below and the user has not explicitly said "just tell me / don't show listings", you MUST include `results`. Omit `results` only on pure info turns where no candidates are supplied.

- Update log line 2067 to also print whether shopping override fired, for future debugging.

### 3. Validation

After edits, in build mode:
- Deploy `chat-ai`.
- `curl_edge_functions` with sample bodies:
  - "2BR in Thao Dien under 25M" → expect `results.length > 0`.
  - "safe apartment for expats near international school in D2" → expect `results.length > 0`.
  - "tell me about Thao Dien" → expect `blocks` only, no `results`.
  - "show me 2BRs in Thao Dien and tell me about the area" → expect both.

## Out of scope

No UI changes, no DB changes, no changes to the lifestyle KB content itself — only the intent classifier and prompt wiring.
