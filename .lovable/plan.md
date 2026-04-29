## Goal
Make Hausto AI reason better and hold conversation context more naturally so follow-ups feel fluid and recommendations are sharper.

## Current limitations (in `supabase/functions/chat-ai/index.ts`)
1. Calls `gpt-5` with no `reasoning_effort` — model defaults to fast/shallow reasoning.
2. Only the last **10 history messages** are sent to the model (line 1762), and DB fetch is capped at **15** (line 1293) — earlier turns get dropped.
3. Previously suggested properties are extracted but only their IDs are surfaced; full conversational memory of "what we already discussed" is thin.
4. System prompt is long and rule-heavy, which can crowd out reasoning. No explicit "think step-by-step" framing or self-check pass.
5. No conversation summary/distillation when history gets long → context window fills with raw chat instead of insights.
6. Image style detection runs on a separate `gpt-4o-mini` call but its findings aren't fed back as a structured memory the main model can reason over turn-after-turn.

## Plan

### 1. Enable real reasoning on the main model
In the main AI call (around line 1774):
- Add `reasoning_effort: "medium"` to the gpt-5 request body (low for short follow-ups, medium for new searches — pick effort based on `isComparisonQuery` / message complexity).
- Bump `max_completion_tokens` to `4000` to give reasoning room.

### 2. Expand and smartly compress conversation memory
- Increase DB history limit from 15 → **40 messages** (line 1293).
- Send last **20** raw turns to the model (was 10, line 1762).
- When history > 20 turns, generate a lightweight "conversation summary" (one extra small Lovable AI call using `google/gemini-3-flash-preview`) capturing: stated preferences, rejected options, properties already viewed, open questions. Inject this summary as a `system` message before the recent turns.

### 3. Strengthen accumulated context
Extend `buildAccumulatedContext` (line 566) to also track:
- **Rejected preferences** — when user says "not that one", "too expensive", "don't like X".
- **Confirmed likes** — properties the user reacted positively to.
- **Open clarifications** — questions the AI asked that the user hasn't answered yet.
Surface these in the system prompt as bullet sections so the model reasons over them, not just current filters.

### 4. Restructure system prompt for reasoning
Reorganize the prompt (line 1643) into clearer sections:
1. Role & tone
2. What we know (accumulated context + rejections + likes)
3. Conversation summary (when present)
4. Available properties (current ranked list)
5. Reasoning checklist — explicit "Before answering, think through: (a) Is this a follow-up or new search? (b) Did the user reject anything I should avoid? (c) Are there open questions I should answer before listing properties? (d) Does my recommendation order respect priority?"
6. Output format

Trim duplicated instructions (the file currently has two "8." and two "9." numbered rules).

### 5. Better follow-up handling
- Expand `detectComparisonQuery` to also catch reasoning-style follow-ups: "why", "tell me more about", "compare these two", "what's the difference", "which is better for…".
- For these, lower property re-fetching and instruct the model to reason over the previously suggested set instead of returning a new JSON results array.

### 6. Feed image analysis back as durable memory
When `imageAnalysisResult` is produced, persist its styles/colors into the `chat_messages.metadata` of the user message so subsequent turns can see "user previously uploaded a Modern/Minimalist reference" without re-analyzing — and include that note in the accumulated-context block.

## Technical changes
- File: `supabase/functions/chat-ai/index.ts`
  - Update history limits (lines 1293, 1762).
  - Add `reasoning_effort` + raise `max_completion_tokens` (line 1774).
  - Add conversation-summary helper (new function, ~30 LOC) invoked when `chatHistory.length > 20`.
  - Extend `buildAccumulatedContext` + add `extractRejections`, `extractLikes` helpers (~40 LOC).
  - Rewrite system prompt block (lines 1643–1746) — same data, cleaner structure, reasoning checklist, deduped numbering.
  - Expand `detectComparisonQuery` patterns (line 628).
  - Persist image-analysis metadata to `chat_messages` when present.

## Out of scope
- No DB schema changes (metadata column already exists on `chat_messages`).
- No model swap — staying on `gpt-5` since it's already wired and has the strongest reasoning of the available set.
- No frontend changes — `useHomeAI`/`HomeAI` already pass full history server-side.

## Expected impact
- More accurate follow-ups ("which one has a balcony?", "compare 2 and 3").
- Fewer repeated suggestions of properties the user already rejected.
- Smoother multi-turn conversations even past 15 messages.
- Better reasoning on ambiguous requests (e.g., "somewhere quieter but still close to D1").
