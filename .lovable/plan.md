

The user wants to revisit the phone-number extraction problem on Batdongsan and Nhatot. Current approach (per memory `mem://architecture/crawler/phone-extraction-automation`): Browserless for Batdongsan, public API for Nhatot, reject masked numbers. Let me check the current implementation and think about better strategies.

Reading existing code mentally based on memory:
- **Batdongsan**: phone is hidden behind a "Show phone" button, requires click + Cloudflare bypass. Browserless renders the page but the number stays masked unless the button is clicked.
- **Nhatot**: has a public API that sometimes returns the phone, but increasingly returns masked (`****`) numbers behind auth/rate limits.

# Plan: Smarter phone-number unblocking for Batdongsan & Nhatot

## The real blockers
- **Batdongsan**: Number is server-rendered as `***` until the user clicks "Bấm để hiện số". Clicking triggers a XHR to `/MAccount/api/contact/getphone?postId=...` which requires a valid session cookie + anti-bot token. Browserless without interaction = always masked.
- **Nhatot**: Public listing API (`gateway.chotot.com/v2/public/ad-listing/{id}`) returns `phone` only when the request carries a valid mobile-app-style header set; web requests get `phone: null` or a masked value.

## Three layers to try (in order of cost/complexity)

### Layer 1 — Cheaper wins first (no Browserless click)
- **Nhatot**: Switch from the public web API to the **mobile gateway endpoint** `gateway.chotot.com/v1/public/ad-listing/{listId}` with mobile headers (`User-Agent: Chotot/...`, `x-app-version`, `x-device-platform: android`). This is what their app uses and it returns `contact_phone` unmasked for most listings. Free, no Browserless cost.
- **Batdongsan**: Many listings expose the phone in the **JSON-LD `<script type="application/ld+json">`** block or in a `window.__NUXT__` payload embedded in the HTML, even when the visible number is masked. Parse these from the already-fetched HTML before falling back to clicking. Free, no extra request.

### Layer 2 — Browserless with interaction (Batdongsan only, when Layer 1 misses)
- Use Browserless `/function` (not `/content`) to actually **click "Bấm để hiện số"** and wait for the XHR response, then read the revealed number from the DOM. Costs ~1 extra Browserless call per listing but works reliably.
- Cache the result on `external_properties.phone` so we never repeat for the same listing.

### Layer 3 — Listing-page contact form fallback
- For listings where all extraction fails, store `phone = null` and surface the listing's source URL in the contact CTA so renters click through to Batdongsan/Nhatot directly. Already the existing fallback — just make sure we don't keep retrying dead extractions (track `phone_extraction_attempts` and stop after 3).

## What to build

1. **Refactor `supabase/functions/extract-phone/index.ts`**
   - New `extractNhatotMobileApi(listId)` using mobile gateway + headers
   - New `extractBatdongsanFromHTML(html)` parsing JSON-LD + `__NUXT__` regex
   - New `extractBatdongsanViaClick(url)` using Browserless `/function` with click + XHR wait (only invoked when HTML parse returns nothing)
   - Order: HTML parse → mobile API → Browserless click → null

2. **Schema addition on `external_properties`** (1 column)
   - `phone_extraction_attempts INTEGER DEFAULT 0` — increment on null result, skip after 3 to control cost

3. **Admin Tools UI** — add a "Re-extract phone" button per listing in the watchlist for manual retries when a listing is known to have a phone we missed.

## Files to touch
- `supabase/functions/extract-phone/index.ts` — the three-layer strategy
- `supabase/migrations/<new>` — `phone_extraction_attempts` column
- `src/pages/AdminTools.tsx` — manual re-extract button

## Decisions to confirm
- **Browserless budget**: OK to use 1 extra Browserless call per Batdongsan listing when HTML parse fails (Layer 2)? Or cap at HTML parse + mobile API only and accept some misses?
- **Retry cap**: 3 attempts before giving up (recommended), or unlimited?
- **Scope**: include both Batdongsan and Nhatot in this refactor (recommended), or Nhatot only since the mobile-API trick is the highest-impact change?

