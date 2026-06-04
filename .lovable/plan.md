## Goal
Make the Discover AI chat feel as responsive as ChatGPT/Gemini — first words on screen within ~0.5–1s instead of a 5–15s blank "loading" wait — while keeping cost the same or lower.

## Where the latency comes from today
`supabase/functions/chat-ai/index.ts` (renter mode) calls **OpenAI `gpt-5` with `reasoning_effort: 'medium'`**, then waits for the full response (up to 4000 tokens), then returns one JSON blob. The client (`useHomeAI`) uses `supabase.functions.invoke('chat-ai', ...)` which buffers the entire response. On top of that, when chat history is long it makes a **second sequential AI call** to summarize history *before* the main call (`await summarizeConversation`). Net: 5–15s of silence per message.

## Four changes, biggest impact first

### 1. Switch the primary model to Lovable AI Gateway / Gemini Flash
- Replace the `gpt-5` (reasoning) call in `chat-ai/index.ts` renter mode with `google/gemini-3-flash-preview` via `https://ai.gateway.lovable.dev/v1/chat/completions` using `LOVABLE_API_KEY`.
- Drop `reasoning_effort` (not applicable) and lower `max_tokens` from 4000 → 1500. The model already returns structured JSON via the existing system prompt — no reasoning model needed for that.
- Realtor mode already uses gemini-2.5-flash, leave it.
- Effect: ~3–5× faster time-to-first-token, and Gemini Flash is materially **cheaper per token** than gpt-5 → **net cost goes down**, not up.

### 2. Stream the response (SSE) end-to-end
- In the edge function, set `stream: true` on the Gateway call and pipe `response.body` straight back to the client with `Content-Type: text/event-stream` (same pattern the codebase already uses for other streaming functions; see the AI-gateway streaming reference).
- Tweak the renter system prompt to emit the human-readable `summary` text **first** as plain prose, then the `{"results": [...], "totalMatches": N}` JSON block. That way tokens that show up first are already useful prose.
- Client (`useHomeAI` + `HomeAI.tsx`): replace `supabase.functions.invoke('chat-ai', ...)` with a direct `fetch` to `${VITE_SUPABASE_URL}/functions/v1/chat-ai` carrying the publishable key, then read the SSE stream line-by-line and append text into the assistant message as it arrives (standard pattern from `connecting-to-ai-models`).
- When the stream finishes, run the existing JSON-extraction + `validateAndFixAIResults` logic on the accumulated text and swap the streamed-prose bubble for the final property-cards UI.
- Persisting to `chat_messages` moves to the end of the stream (assemble full text server-side as we forward, write once on `[DONE]`). No extra DB writes.
- Effect: first token visible in ~300–800ms; perceived speed matches ChatGPT/Gemini.

### 3. Stop blocking on the conversation summary
- Currently: `await summarizeConversation(...)` happens **before** the main model call when history > 20 turns, adding 1–2s of dead time.
- Change: fire the summary call with `Promise.all([summarizeConversation(...), buildPropertyContext(...)])` so it overlaps with property scoring; if it's still not ready by the time we build the main prompt, skip it for this turn and persist the summary into the conversation row for the next turn to use.
- Effect: 1–2s saved on long conversations, zero quality loss after the first long-history turn.

### 4. Trim the prompt
- Reduce `chatHistory.slice(-20)` → `chatHistory.slice(-10)` in the renter-mode message assembly. The accumulated-context block + summary already carry long-term memory; raw turns past 10 add tokens (and latency) for marginal benefit.
- Effect: smaller prompt → faster TTFT + lower input-token cost.

## What stays the same
- All existing pre-scoring, location knowledge, validation, fallback, deduping, persistence, usage tracking.
- Realtor mode unchanged.
- Image style analysis path unchanged (only runs when user uploads reference images).
- Database schema unchanged.

## Files touched
- `supabase/functions/chat-ai/index.ts` — switch model + stream + parallelize summary + trim history + tweak prompt ordering (summary text first, JSON last).
- `src/hooks/useHomeAI.tsx` — replace `functions.invoke` with streaming `fetch`, expose progressive `streamingText` to the UI.
- `src/components/HomeAI.tsx` — render the in-flight assistant message from `streamingText` (text appears as it streams), then swap to the property-cards view when the JSON block is parsed at stream end.

## Cost impact
- Gemini Flash is cheaper than gpt-5 per input + output token, and we drop reasoning tokens entirely → expected **~40–70% cheaper per chat turn**.
- Streaming itself adds zero cost.
- Shorter history window and lower max_tokens cap further reduce token usage.

## Out of scope
- Realtor proactive AI (`proactive-ai-reply`, `hausto-ai-assist`) — not what shows up in the Discover/Home chat the user is asking about.
- Switching providers for image style analysis (separate hop, only runs on image uploads).
- Caching of repeated queries (could come later if needed).
