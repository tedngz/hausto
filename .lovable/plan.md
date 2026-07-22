## Investigation (what I can and can't see)

Edge function analytics only retain a rolling ~3-minute window in this workspace — I pulled the last 7d and got back only the most recent 487 rows (all within 3 minutes, dominated by `check-paypal-subscription`). That means I **cannot directly attribute yesterday's OpenAI spend** to a specific function from logs. The plan below is therefore split into (a) instrumentation so we can attribute cost next time, and (b) high-confidence cost cuts on the functions we know use vision-heavy `gpt-4o-mini` calls.

## Most likely culprits (by code inspection)

Ranked by tokens-per-invocation × how often they can fire:

1. **`analyze-vibe` / `backfill-image-highlights`** — vision, up to **5 images per property**, 500 max_tokens each, `detail: 'auto'` (often expands to high). One property ≈ 5 vision calls ≈ 50k+ image tokens.
2. **`scrape-marketplace`** — vision on listing detail pages during scheduled crawls.
3. **`scheduled-crawl`** cron — chains 1 + 2 automatically; if it ran unthrottled or backfilled a queue, spend compounds fast.
4. **`chat-ai`** — text-only, cheap per call, but every user message hits it.
5. **`batch-reanalyze-properties` / `backfill-image-highlights`** — if manually kicked from AdminTools, processes many properties in one run.

Most likely explanation for a sudden jump: a **backfill or batch reanalyze was triggered**, or the **scheduled crawler picked up a burst of new listings** and ran vision on all their images.

## Plan

### Phase 1 — Add attribution (so this is answerable next time)
1. In every OpenAI-calling edge function, log a single structured line per call:
   `[cost] fn=<name> model=<m> prompt_tokens=<n> completion_tokens=<n> images=<n>` using the `usage` block OpenAI returns.
2. Create `openai_usage_log` table (fn, model, prompt_tokens, completion_tokens, images, created_at) + insert from each function via service role. RLS admin-only. Add a small AdminTools panel showing today/yesterday/7d totals grouped by function.

### Phase 2 — High-confidence cost cuts (no behavior loss)
1. `analyze-vibe` + `backfill-image-highlights`: change image `detail: 'auto'` → `detail: 'low'`. Cuts image tokens ~3–5×. Vibe scoring and short highlights don't need high detail.
2. Cap images analyzed per property from 5 → 3 (keep 1st + 2 highest-quality). Configurable constant.
3. `scrape-marketplace`: skip vision if the listing already has description + ≥3 images from the source's metadata.
4. `chat-ai`: cache system prompt + lifestyle-KB context in Redis keyed by hash; skip re-embedding the same user turn on retries.
5. `scheduled-crawl`: reduce cadence (30 min → 2 h) and hard-cap `maxNewPropertiesPerRun` at 5.

### Phase 3 — Guardrails
1. Add a daily USD budget check (env `OPENAI_DAILY_BUDGET_USD`). Before each vision call, sum today's `openai_usage_log` cost estimate; short-circuit with a logged skip if over budget.
2. Disable auto-trigger of `batch-reanalyze-properties` from any UI path; require an explicit admin confirm dialog with expected call count.

### Technical notes
- Cost estimator constants (per 1M tokens, gpt-4o-mini): input $0.15, output $0.60. Image tokens: `low` ≈ 2833/img, `auto/high` ≈ 8500–25500/img. Phase 2.1 alone typically cuts vision spend by 60–80%.
- No frontend changes required for Phase 1–3 except the AdminTools usage panel.
- Migrations: 1 new table + RLS + admin policy.

Approve and I'll implement Phase 1 + Phase 2 together (Phase 3 in a follow-up).