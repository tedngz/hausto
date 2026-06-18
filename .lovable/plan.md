## Goal
Revert every edge function that currently uses Lovable AI Gateway / Gemini models back to direct OpenAI API calls, using the existing `OPENAI_API_KEY` secret (already configured).

## Model mapping
- `google/gemini-3-flash-preview` → `gpt-4o-mini`
- `google/gemini-2.5-flash` → `gpt-4o-mini`
- (Vision-capable calls stay on `gpt-4o-mini`, which supports image inputs.)

## Files to update

1. **`supabase/functions/chat-ai/index.ts`** — 3 call sites (lines ~869, ~1638, ~2204). Replace gateway URL `https://ai.gateway.lovable.dev/v1/chat/completions` with `https://api.openai.com/v1/chat/completions`, swap `LOVABLE_API_KEY` → `OPENAI_API_KEY`, and update model strings.

2. **`supabase/functions/hausto-ai-assist/index.ts`** — 1 call site (~line 174). Same swap.

3. **`supabase/functions/scrape-marketplace/index.ts`** — Remove Lovable gateway branch; always use OpenAI when an `OPENAI_API_KEY` is present. Update the `if (LOVABLE_API_KEY)` block and the two guard checks.

4. **`supabase/functions/crawl-external-properties/index.ts`** — Drop Lovable fallback; require `OPENAI_API_KEY`. Simplify the `apiKey`/`model` selection to OpenAI only.

5. **`supabase/functions/recrawl-external-listing/index.ts`** — Same: drop `useGateway` branching, always call OpenAI with `gpt-4o-mini`.

## Out of scope
- `generate-property-embedding` and `batch-generate-embeddings` already use OpenAI — no change.
- `analyze-vibe` already uses OpenAI — no change.
- No DB migrations.
- No frontend changes.
- `LOVABLE_API_KEY` secret stays in place (used by other potential features); we just stop calling it from these functions.

## Verification
After edits, tail-check each file with `rg "LOVABLE_API_KEY|gemini|ai.gateway.lovable"` to confirm zero remaining references in the five functions.
