Problem: Follow-up chips in the AI chat don't visually distinguish between search/comparison actions (which will return property listings) and general advice actions (which will return info blocks like district profiles, distances, or complex details). Users can't predict what tapping a chip will do.

Changes:

1. Edge function system prompt (`supabase/functions/chat-ai/index.ts`)
   - Update the `followups` rule to instruct the AI to categorize suggestions by intent:
     - Search/comparison follow-ups: prefix with `[Search]` — e.g. `[Search] 1BR under 15M in Thao Dien`
     - Info/advice follow-ups: prefix with `[Ask]` — e.g. `[Ask] Is Thao Dien pet-friendly?`
   - Update the JSON example block to show the new prefix format.

2. UI chip rendering (`src/components/ai-blocks/AIBlocks.tsx`)
   - Parse the `[Search]` / `[Ask]` prefixes from suggestion text.
   - Strip the prefix for display but use it to style the chip:
     - `[Search]` chips → use `Badge` or `Button` with a `Search` icon (magnifying glass) and a subtle primary-tinted outline.
     - `[Ask]` chips → use `MessageCircle` or `Lightbulb` icon and a subtle secondary/muted outline.
   - Add `title` tooltip text on each chip: "Find listings" vs "Get advice".
   - Pass the stripped suggestion text to `onFollowup` so the downstream handler receives clean user-style text.

No database or API contract changes. The prefix is a display convention parsed and stripped in the UI.