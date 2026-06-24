# Make Hausto AI a real lifestyle advisor (not just a listing pusher)

## Problem
Today `chat-ai` is heavily biased toward returning listing cards. When users ask "Where's the best place to live in HCMC?", "What's Thao Dien like?", or "How much does living in District 1 cost?", the model either dumps property cards or gives shallow answers, because the only inline knowledge it has is a 6-line `LOCATION KNOWLEDGE` blurb and a small `KNOWN DISTANCES` table. Real lifestyle/cost-of-living/vibe knowledge isn't in the prompt, so the model either guesses (token-expensive, sometimes wrong) or falls back to "here are some apartments".

## Goal
- Answer lifestyle questions (best areas, vibe, cost of living, safety, food/cafe scene, schools, expat fit, commute trade-offs) genuinely, with confident, locally-grounded text.
- Use a static curated knowledge base instead of asking the model to invent — saves tokens (smaller prompts + no listing payload when not needed) and improves trust.
- Keep the existing shopping flow (results cards) intact; only change how info-intent turns are handled.

## What we'll build

### 1. New curated knowledge base file
`supabase/functions/_shared/lifestyle-kb.ts` — single source of truth, shared by edge functions.

Structure (TypeScript, plain data, no DB):

```ts
export type DistrictKB = {
  city: 'ho chi minh' | 'hanoi';
  district: string;          // canonical display name
  aliases: string[];          // matching keys, lowercase, accent-stripped
  vibe: string;               // 2–3 sentence neighborhood character
  bestFor: string[];          // e.g. ["families","long-stay expats","nightlife"]
  notFor: string[];           // honest trade-offs
  costOfLiving: {
    rent1BR: [number, number];   // USD/month range
    rent2BR: [number, number];
    rent3BR: [number, number];
    diningOutMid: string;        // "$8–15/meal"
    groceriesNote: string;       // imported vs local
    transportNote: string;       // Grab/metro/bike
  };
  food: string;               // cafe & restaurant scene summary
  schools: string;            // intl schools nearby (or "none")
  safety: string;             // honest safety note
  expatFit: string;           // who it suits, language friendliness
  commute: string;            // to CBD / airport summary
  notableComplexes: string[];
};
```

Seed coverage (v1):
- **HCMC**: District 1, District 3, District 4, District 7 (Phu My Hung), District 2 / Thu Duc (Thao Dien, An Phu, Thu Thiem), Binh Thanh, Phu Nhuan.
- **Hanoi**: Hoan Kiem, Ba Dinh, Tay Ho, Cau Giay, Hai Ba Trung, Dong Da, Long Bien.
- **City-level overview** entries: "ho chi minh" and "hanoi" with cost-of-living summary + "best area for X" guidance (families / nightlife / budget / luxury / digital nomads).

Where possible we'll reuse the prose already in `src/data/locationDescriptions.ts` so the frontend tag tooltips and the chat answers stay consistent. The KB file is a Deno-friendly `.ts` (no React imports).

### 2. Wire KB into `chat-ai` edge function
In `supabase/functions/chat-ai/index.ts`:

a. **Intent detection** — extend the existing classifier so a turn is tagged `lifestyle` when the message matches patterns like: "where's the best place to live", "what's the vibe", "cost of living", "is X safe", "good for families", "tell me about <district>", "compare X vs Y", "should I live in", and the user has NOT provided shopping filters (budget + bedrooms + "show me / find").

b. **KB lookup** — `findRelevantKB(message, accumulatedContext)` returns at most 2 district entries plus the matching city overview. Matching uses the alias list and the existing accent-stripping helper.

c. **Slimmer prompt for lifestyle turns** — when intent is `lifestyle`:
  - Skip the huge `AVAILABLE PROPERTIES` block and the property scoring pipeline entirely (the biggest token sink).
  - Inject only: user's accumulated requirements (if any), the matched KB entries (verbatim JSON), and the existing `KNOWN DISTANCES` table.
  - Instruct the model to answer in plain prose using ONLY the KB entries + general HCMC/Hanoi knowledge already in `LOCATION KNOWLEDGE`. No invented prices, no invented complex facts.
  - Response shape: `{ "blocks": [ { "type": "text", "body": "..." }, { "type": "district", ... }, { "type": "followups", "suggestions": [...] } ] }` — reusing the block types the frontend already renders. Followups should mix one `[Ask]` (deepen the lifestyle thread) and one `[Search]` (offer to convert to listings) so the user can transition to shopping when ready.

d. **Mixed turns** — if the user asks lifestyle + shopping in one message ("tell me about Thao Dien and show me 2BRs under 25M"), keep the current shopping pipeline AND prepend a `text` block sourced from the KB.

e. **Logging** — log `[AI] intent=lifestyle kb_hits=...` so we can see KB hit rate and trim/expand entries later.

### 3. System prompt update
Add a short section right after `LOCATION KNOWLEDGE`:

> 🏘️ LIFESTYLE KNOWLEDGE (authoritative — quote from here, do NOT invent):
> {injected KB entries as compact JSON}
>
> When the user asks about lifestyle, vibe, cost of living, safety, schools, food, or "best area for X", answer from this block. If the answer isn't covered, say so briefly and offer to search listings or point to a nearby district that IS covered.

Tighten rule #10 ("WHEN to use which intent") to explicitly list lifestyle triggers and to forbid returning `results` on a pure lifestyle turn.

### 4. Frontend
No required changes — `HaustoChat` already renders `text`, `district`, `complex`, `distance`, and `followups` blocks. (We'll verify once during build; if `district` rendering looks thin we'll widen the card to include `bestFor` / `tradeoffs` chips, but that's a polish follow-up, not part of this plan.)

## Out of scope (can be follow-ups)
- Vector/RAG search over a larger KB — overkill for ~15 districts; inline JSON is faster and cheaper.
- Per-user persistence of lifestyle preferences (already partly handled by `accContext`).
- Admin UI to edit the KB — for v1 it's a code-owned file; we iterate via PRs.
- Hanoi neighborhoods beyond the 7 listed above.

## Technical details
- KB file is ~400–600 lines of plain TS data; gzipped prompt impact per lifestyle turn is small (~1–2KB injected, vs the 5–15KB property block we skip).
- No DB migration, no new secrets, no new dependencies.
- Files touched:
  - `supabase/functions/_shared/lifestyle-kb.ts` (new)
  - `supabase/functions/chat-ai/index.ts` (intent classifier, KB lookup, prompt branching)
- Token math (rough): a typical lifestyle turn today costs ~6–10K input tokens (full property block + history). With the branch, it drops to ~1.5–2.5K — ~70% reduction on info turns, which is a meaningful share of traffic.

## Open question
Should the lifestyle answers use **USD ranges** (matches the expat target persona in project knowledge) or **VND** (matches the rest of the app's price formatting)? Default in the plan above is **USD for cost-of-living narrative** (because expats compare in USD pre-arrival), **VND for any concrete listing prices** (consistent with cards). Flag if you want it unified.
