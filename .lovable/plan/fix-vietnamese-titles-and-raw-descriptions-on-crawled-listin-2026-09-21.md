# Fix Vietnamese titles and raw descriptions on crawled listings

## What's happening

Listings from Nha Tot are the only ones affected. Checked against the live data:

| Source | Live listings | Vietnamese title | Raw Vietnamese description |
|---|---|---|---|
| Nha Tot | 42 | 19 | 16 |
| Batdongsan | 102 | 1 | 0 |
| HousingSGN | 35 | 0 | 0 |

The reason: for every other site the crawler reads the page and passes the text
through the AI writer, which produces an English title and a clean 2-3 sentence
description. Nha Tot is different - the crawler takes the listing straight from
Nha Tot's own data feed (cheaper and more reliable for photos, price and
bedroom count) and skips the writing step entirely. So the seller's original
Vietnamese headline and their full emoji-filled advert text are saved exactly as
posted, which is what the screenshots show.

## The fix

**1. Write Nha Tot listings like the others.**
After the listing is built from the feed, pass its headline, advert text and
amenity lines through the same cheap AI writing step used elsewhere: English
evocative title, 2-3 sentence English description, tidy English amenity list.
Street/ward/district names stay in Vietnamese, as today. Price, size, bedrooms,
photos and contact data are untouched - they come from the feed and are already
correct. If the writing step fails, keep the original text rather than dropping
the listing.

**2. Clean up the listings already stored.**
A one-off backfill pass that finds live listings whose title or description is
still Vietnamese and rewrites just those two fields plus amenities from the text
already in the database. No re-crawl, no page fetches - text only, so it is a
few cents for the whole set. Triggered from the admin tools page alongside the
other backfill buttons, and safe to re-run.

## Technical notes

- `supabase/functions/_shared/nhatot.ts` keeps returning raw feed values; the
  normalisation is a new shared helper called from the nhatot branch of Phase 2
  in `supabase/functions/scrape-marketplace/index.ts` (around line 2257), so the
  feed parser stays pure and testable.
- Model `gpt-4o-mini`, text-only, one call per listing, batched with the
  existing Phase 2 concurrency of 3. Usage recorded through
  `logOpenAIUsage` with a distinct `fn` label so it shows in the OpenAI usage
  panel.
- New edge function `backfill-listing-language` for step 2: admin-gated,
  processes a capped batch per invocation (default 20), selects rows where
  `is_active` and title/description match Vietnamese diacritic or keyword
  patterns, updates `title`, `description`, `amenities` only.
- `supabase/config.toml` entry for the new function; button added to
  `src/pages/AdminTools.tsx` next to the existing backfills.
- `recrawl-external-listing` already runs AI extraction for nhatot, so it needs
  no change.
