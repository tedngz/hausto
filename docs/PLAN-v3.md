# Execution plan v3

Supersedes PLAN-v2. Written 2026-09-10 after re-running the audit against the
live database rather than against the public search API. Read alongside
`CLAUDE.md` and `docs/SPEC.md`.

v2 was built on six audit findings taken from `public-property-search` output and
`llms.txt`. Four of them were wrong, and two milestones were scoped to build
things that already exist. The strategy - supply first, then identity, then
intake, then the ops console - survives. The sequencing does not.

---

## Audit, re-run against the database

All figures from `public.external_properties` on 2026-09-10.

### What v2 got right

- **Supply is the binding constraint.** 115 active listings, 109 of them HCMC. A
  renter filtering to a district, a price band and a style gets single-digit
  results. Nothing downstream works until this moves.
- **housingsgn.com is one agency's own site.** One contact row covers the source.
- **Field-level data quality will break the ops flow.** Worse than v2 described;
  see S3.
- **Confirmed-available rate is the number to watch.**

### What v2 got wrong

**1. There are three sources, not two.** nhatot (Chotot) has been crawled since
at least April - 337 HCMC rows, plus 68 Hanoi and 15 Da Nang. v2's top S1 item,
"add Chotot (largest volume)", is already built. `scheduled-crawl/index.ts:327`
enables all three marketplaces.

**2. Realtor phones are already resolved, not waiting for a regex.**
`contact_phone` is populated on 487 of 696 rows and on **100 of 115 active
(87%)**. There is an `extract-phone` edge function and a
`phone_extraction_attempts` column. v2's S2 acceptance criterion - "≥60% of
active HCMC listings have a resolved realtor" - was already exceeded when it was
written.

**3. `vibe` is not null on every row.** 287 of 696 rows carry it (28 of 115
active). More to the point, `vibe` is not just a response field: the style filter
reads it via `ilike` at `public-property-search/index.ts:116` and `:191`.
Removing it without re-pointing those breaks style filtering. All 115 active rows
have a populated `vibe_analysis->styles`, so the move is safe once made
deliberately.

**4. There is no `posting_count` column.** Dedup already exists but is built
differently: `canonical_group_id`, a `listing_groups` table, `image_hashes`, a
`hash-listing-images` function and a `dedupe-external-listings` cron at 19:10
daily.

**5. The freshness machinery v2 asks for is largely present.**
`deactivated_at`, `expires_at`, `last_verified_at`, `last_verification_status`,
`last_verification_reason` and `verification_failures` all exist, drained by
`verify-external-listings` every 20 minutes plus a daily pass. What is missing is
only `delisted_at` - a *price-confirmed* delisting signal, distinct from "the URL
stopped resolving".

**6. The 111 figure is not 111 external listings.** The API's
`total_active_listings` sums external actives, internal `properties` (132 rows)
and subtracts duplicate excess. Do not use it as a supply metric.

### What the audit found that v2 missed

These reshape S1 far more than the source list does.

**A. Two of three sources stopped producing rows - but not because the crawler
stopped running.**

| Source | Last row crawled | Rows in last 14 days |
|---|---|---|
| batdongsan | 2026-09-09 | 26 |
| housingsgn | 2026-08-31 | 2 |
| nhatot | **2026-08-06** | **0** |

The obvious reading is that the crawler stalled. It did not. `crawler_rejections`
shows nhatot being crawled daily right through 2026-09-09 and **rejecting every
candidate** - 894 of them as `too_few_images:1`. The rejected rows carry one
`preset:listing` cover image apiece, while the ad API holds 9 to 13 gallery
photos for the very same ids. nhatot renders client-side, so the detail scrape
returned a shell, Phase 2 produced nothing, and the search-page fallback took
over - and a search card carries only the cover. The fallback excluded
`housingsgn` and not `nhatot`.

So "no new rows" and "the crawler stopped" are different diagnoses, and only one
of them was true. Check `crawler_rejections` (`reason`, `sample_images`,
`rejected_at`) before believing a source has gone quiet.

The cron is also firing **twice**: `auto-crawl-v2` and `auto-crawl-v3` are both
active on `*/30 * * * *`, both POSTing `scheduled-crawl`. v2 sends the anon key,
which matches none of the four auth branches in that function, so it has been
401ing 48 times a day since `20260818140000` closed the endpoint to it. A lot of
green-looking cron history that never did anything.

**B. nhatot ads come back from the dead, and nothing looks.** 383 of 425 nhatot
rows carry `last_verification_reason = 'gateway_not_found'`. Probed against
`gateway.chotot.com/v1/public/ad-listing/<id>` on 2026-09-10:

- The gateway is **not** blocking us. 404s return a genuine
  `"entity not found - no ad found for list id ..."`, and four known-alive
  controls returned 200 with full ad payloads. Rate-limiting and IP blocking are
  ruled out.
- But **6 of 56 sampled dead rows (about 11%) are live right now**, under the
  same ad id, and every one of them carries a `list_time` inside the last ten
  days. Two were reposted within hours of the probe. `nt120973808` was marked
  dead on 2026-09-09 and was back seven hours before this check.

So the 404s were true when verification saw them. Chotot ads expire, the seller
bumps or reposts, and **the same list id comes back live**. That is normal
behaviour on the platform, not an anomaly.

The bug is that deactivation is a one-way door. `verify-external-listings`
selects `.eq('is_active', true)` (lines 261 and 278), so once a row is marked
dead nothing ever re-checks it. Every repost is lost to us permanently. At any
instant roughly 30 of the 383 dead nhatot rows are live and invisible, and
because reposting is continuous, a recurring sweep recovers far more over time
than that snapshot suggests.

Note this is distinct from `is_relist`, which `dedupe-external-listings` sets
when the *same property* reappears under a *different* id. This is the same id
returning.

**C. 99 active-quality rows are sitting switched off.** They verified `alive` and
have `is_active = false`. Fifty of them were **never deactivated** -
`deactivated_at` is null, `expires_at` is not past, all are priced, 49 of 50 have
three or more images. Forty-five are housingsgn rows crawled in a single week
(2026-06-30 to 07-06). That is a 43% increase in the live index sitting in the
table already, before a single new crawl.

**D. Zero active listings are geocoded.** `latitude` is null on all 115, despite
`batch-geocode-properties` existing and `docs/basemap.md` describing map
surfaces. Not on the critical path for viewings, but it means district-clash
warnings in S6 must work off `district_code`, not coordinates.

**E. The price bug is live and it is a currency bug.** The worst active row is
`price = 730`, `price_display = '$730 / month'` - a housingsgn USD figure stored
raw in a VND column. v2 described this as an extraction disagreement; it is a
missing conversion, and it is systematic to one source rather than random.

---

## Revised sequence

Five milestones. v2's S1 and S2 collapse into one shorter block, because most of
what they specified is either built or a repair rather than a build.

### S1 - Supply retention, then depth (3 days) - do this first

Retention before acquisition. In order:

1. **Fix the rejection path that was eating nhatot.** Done in #72: nhatot
   listings are now built from the chotot ad payload rather than scraped, and
   nhatot is excluded from the search-page fallback that could only ever supply
   the cover image. Still outstanding, and the reason this took a database dig
   rather than a glance at a dashboard: **instrument `scheduled-crawl` to record
   per source, per run - rows attempted, written, and rejected with why.** A run
   that rejects 100% of candidates currently reports success.
2. **Delete one of the two crawl crons.** `auto-crawl-v2` and `auto-crawl-v3` run
   the same function every 30 minutes with different auth. Keep v3, drop v2.
3. **Recover the switched-off rows.** Cause found and fixed in #72:
   backfill-image-highlights hides a listing on a failed highlight pass and
   enqueues the retry fire-and-forget, swallowing the insert error, so a failed
   enqueue left the row hidden with nothing scheduled. 45 housingsgn rows sat
   that way for two months with their analysis already complete. **41** of the
   50 clear the five-image display floor and are revived by migration; the other
   nine genuinely have too few images and stay hidden.
4. **Add a resurrection sweep, and stop treating dead as final.** Chotot ads
   expire and are reposted under the same list id - about 11% of our dead nhatot
   rows are live at any given moment (finding B). `verify-external-listings`
   only ever looks at `is_active = true`, so a reposted ad is lost forever. Add
   a low-rate pass over rows dead by `gateway_not_found`, newest first,
   reactivating any that return 200 and refreshing price and images from the
   payload. Cheap: one gateway call per row, no crawling, no HTML.
   Alarm when a single verification reason accounts for more than 20% of a run's
   outcomes - that is the check that would have caught this in August, and it is
   also what would catch a genuine block if the gateway does start refusing us.
5. **Add `delisted_at`,** set only when a re-verification confirms the unit is
   gone or the price moved. Decay listings out of search after 21 days without a
   price-confirming re-verification. Keep `deactivated_at` for URL-level death.
6. **Then, and only then, add sources.** 3-5 expat-facing broker sites in the
   housingsgn mould, then the two or three HCMC expat rental Facebook groups that
   matter. Chotot is already in - make it produce again rather than re-adding it.
7. **Drop Hanoi and Da Nang** from crawl and search. HCMC only until the flow
   works. Six active rows and 120 inactive ones are affected; this is a filter,
   not a project.

**Done when:** per-source crawl telemetry exists and all three sources have
written rows in the last 24 hours; the 41 recovered rows are live; the
resurrection sweep runs on a schedule and has reactivated its first batch; a
single verification reason cannot silently deactivate more than 20% of a run;
≥800 active HCMC listings, with ≥2,000 as the standing target once the leak is
closed and new sources land.

> v2 targeted 2,000 active as a gate on everything downstream. That target is
> right and unchanged, but gating S3-S6 on it means the ops console does not get
> built until the crawler work lands. 800 is enough to exercise the flow with
> real inventory, so treat 800 as the gate and 2,000 as the goal.

### S2 - Realtor identity (0.5 day)

Most of this is done. What remains is normalization, not extraction.

1. Create `realtors` and `realtor_identities` per SPEC §1.
2. Backfill `realtors` from the 487 rows that already carry `contact_phone`,
   normalizing to E.164 and collapsing the duplicates - one broker appears across
   many listings.
3. Add `source_agent_id` to `external_properties` and populate it from the
   batdongsan seller box during the S1 crawler work, while that code is open.
4. Wire ingest resolution order: agent identity → phone match → NULL and enqueue.

The regex pass over title, description and source_url that v2 specified as step 1
is worth running **once**, over the 209 rows with no `contact_phone`, and then
retiring. It is not a milestone.

**Do not** attempt full coverage. Unresolved listings stay searchable; they need
a contact only when a renter shortlists them, and ops resolves those on demand at
request time. Every on-demand resolution enriches the table permanently.

**Done when:** `realtors` and `realtor_identities` exist and are backfilled;
ingest auto-attaches on `source_agent_id`; `/ops/resolve` lets an operator
resolve an unknown in under 60 seconds.

### S3 - Data normalization (1.5 days)

Canonical columns per SPEC §0: `price_vnd`, `price_confidence`, `bedrooms`,
`bedrooms_is_min`, `area_sqm`, `district_code`.

The live shape of the problem, on 115 active rows:

- `rooms` parses as an integer on **0** of them. Six distinct strings: `'2
  Bedrooms'` (49), `'3 Bedrooms'` (34), `'1 Bedroom'` (15), `'Studio'` (9),
  `'4+ Bedrooms'` (6), `'4 Bedrooms'` (1), null (1).
- `size` parses as a number on **17** of them.
- `location_normalized` is populated on all 115 but is diacritic-stripped prose,
  not a district code. Three active rows normalize to `'h ni'` - Hanoi rows that
  S1 removes.
- Price: fix the housingsgn USD conversion first, as a source-level rule, before
  building the title/description cross-check. Then flag `price_confidence = LOW`
  where extracted and described prices disagree by more than 15%, and exclude
  `LOW` from shortlisting.

Drop `vibe` from the API response - **after** re-pointing the style filter at
`vibe_analysis->styles` at `public-property-search/index.ts:116` and `:191`. Keep
`style_tags`, `image_highlights`, `amenities`. Extend the response additively;
never break its shape. It serves AI crawlers via llms.txt and will serve the
WhatsApp agent.

**Done when:** every active listing has a canonical bedroom count, area, district
and VND price; the `$730` row and its class are caught by an assertion in CI, not
by a human reading a table; style filtering still returns the same rows it did
before `vibe` was removed.

### S4 - Request intake and the WhatsApp handshake (3 days)

Shortlist 3-5 units in the existing SPA. Availability windows as chips. Phone
entry. Confirmation page with the `wa.me` deep link carrying the request ref.

Tables per SPEC §1: `renters`, `viewing_requests`, `request_items`, `events`,
`messages`, `jobs`. Reducer per SPEC §3.

Edge Functions: `whatsapp-webhook` (signature verify, inbound routing, service
window tracking) and `whatsapp-send` (persist-then-send, idempotency key,
`sendFreeForm` throws when the window is shut).

`MockAdapter` and `/dev/phone` per SPEC §5. Everything demoable before Meta
approval lands. New functions need a `supabase/config.toml` entry, and the
webhook needs `verify_jwt = false` or Meta's request is rejected before it
reaches the code.

**Done when:** request → deep link → simulated send → confirmation reply, all on
mock, with the service window expiry set correctly and every message row written
before its send.

### S5 - Ops console (4 days) - the critical path

A separate small Vite + React app behind Supabase Auth with an `ops` role and
RLS. Keep it out of the renter SPA. It should stay ugly and fast.

Request queue by SLA. One card per shortlisted unit showing the resolved realtor
phone, the cached Vietnamese draft, a copy button, and the seven fixed outcome
actions from SPEC §4.

**The paste-parse box is one of the four days.** Operator pastes the broker's
Zalo reply; an Edge Function returns `{outcome, slots[], actual_price_vnd, note}`
pre-filled into the action form; operator confirms with one click and can
override any field. Throughput comes from interpretation, not typing.

Timers via `pg_cron` against `jobs`. Realtor view must not select renter contact
columns at all - SPEC §6.

**Done when:** an operator drives a request end to end through buttons; paste-
parse achieves ≥80% correct outcome classification on 30 real broker replies.

### S6 - Itinerary, delivery, templates (3 days)

Hand-ordered itinerary with district-clash warnings computed from `district_code`
(not coordinates - nothing is geocoded). One consolidated itinerary message.
Intent classification on the reply. Four utility templates. Reminders. Opt-out.
`FAILED_NO_SUPPLY` with substitutes.

**Done when:** a 3-of-5 partial result produces one well-formed message; no
request can go more than 24h without the renter hearing something, asserted as a
property test.

---

## The WhatsApp agent: scope it narrowly

The agent gets `public-property-search` as a tool. The same contract already
served to ChatGPT and Perplexity via llms.txt - one endpoint, three consumers.

**In scope:**
- Substitutes when a shortlisted unit falls through
- Follow-up search after a request: natural-language query → 3 results, one photo
  and two lines each, deep link to the property page
- One-tap re-request from a suggested listing
- Weekly new-listing digest matched to saved criteria (template message)

**Out of scope:**
- First-time discovery. The style layer is visual - image highlights, style tags,
  photo grids. WhatsApp cannot render a filterable grid and it is not worth
  trying.
- The initial multi-select. That is a web UI.
- Open-ended conversation. Intent classification over a closed set, then route.

Cost discipline: from 2026-10-01 messages inside the service window are billed.
Every agent turn is a line item. Cap the agent at 3 suggestions per reply and one
reply per inbound message.

---

## Realtor-side automation: what is and isn't reachable

| Capability | Automatable now? | Notes |
|---|---|---|
| Vietnamese draft generation | Yes, today | Per-listing, cached at request time |
| Parsing broker replies | Yes, today | Paste-parse in S5. The real throughput win. |
| Follow-up scheduling and nudges | Yes, today | `pg_cron` over `jobs` |
| Sending on Zalo | No | See below |

Sending is blocked on channel, not on AI. Zalo OA plus ZNS requires a
Vietnam-registered entity and per-template approval - weeks, not days.
Personal-account automation libraries violate Zalo's terms and get the number
banned, which will happen precisely when you have paying customers.

Sequence: manual send with LLM draft and LLM parse (S5) → Chrome extension over
web.zalo.me that prefills the draft, sends on one click and captures the reply
into the DB (one week, after ~200 real threads) → OA/ZNS once the entity exists.

The manual phase is a prerequisite, not a stopgap: ZNS templates cannot be
approved for message patterns you have not validated, and the transcript corpus
from those threads is what the drafts and the parser get trained against.

---

## What to cut

Already out: route optimization, calendar sync, realtor accounts, i18n framework.

Newly out for this phase:
- Hanoi and Da Nang. HCMC only.
- Renter accounts beyond a phone-keyed session.
- Any Zalo integration.
- Geocoding the index. Zero active rows have coordinates and the viewing flow
  does not need them. Do not let `batch-geocode-properties` become S1.
- A `NEEDS_REVIEW` unit-clustering console. Extend `canonical_group_id` and
  `listing_groups` instead of building a review queue.
- Metrics dashboard. Emit the events; read them with SQL for now.

**Not out, contrary to v2: payments.** Polar is live and shipping - `passes`,
`create-pass-order`, `capture-pass-order`, `handle-polar-webhooks`, the $25 /
30-day Pass. v2 listed "payments, subscriptions, paywalls" as out of scope, which
read as licence to ignore or remove working revenue code. The correct rule is:
build no *new* payment surface for the viewing flow, and leave the Pass alone.
See the Payments section of `CLAUDE.md` before touching any of it.

---

## Critical path

S1 (3) and S2 (0.5) run in parallel. Then S3 (1.5) → S4 (3) → S5 (4) → S6 (3).

Roughly **11 working days**, down from v2's 15 - the saving is entirely S1 and S2
no longer building what exists. S5 is the one milestone not to compress.

S1 gates S3 only on the 800-listing threshold, and S3 onward can start against
the recovered index while new sources are still landing.

Launch is gated on Meta Business verification and on having a Vietnamese-speaking
operator who has already run 10 requests by hand. Start both today; neither is
code.

## The number to watch

Confirmed-available rate: of the listings a renter shortlists, what share does
ops confirm as actually available at the stated price. Below ~40% and the answer
is never a better booking flow - it is a better index.

Second number, for S1 only: **active rows written per source per day.** It would
have caught nhatot 35 days ago.
