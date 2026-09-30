# Execution plan v3

Supersedes PLAN-v2. Written 2026-09-10 after re-running the audit against the
live database rather than against the public search API. Read alongside
`CLAUDE.md` and `docs/SPEC.md`.

v2 was built on six audit findings taken from `public-property-search` output and
`llms.txt`. Four of them were wrong, and two milestones were scoped to build
things that already exist. The strategy - supply first, then identity, then
intake, then the ops console - survives. The sequencing does not.

---

## Where it stands, 2026-09-28

Read from production and the repo, not remembered. The rest of this document is
the plan as written on 2026-09-10, with status notes added per milestone.

**The software milestones are built and live; supply and realtor contacts are
not at their bars.** The code path S3-S6 describes runs in production, on the
real WhatsApp number since 2026-09-18, and the AI operator (SPEC §10), which
this plan did not foresee, now does much of the operator's work through a Zalo
bridge. What is short is exactly what this plan said would be short: listings
and dialable brokers.

| Milestone | State | Against its "done when" |
|---|---|---|
| S1 supply | Retention built, depth not | 180 active (753 total) against an 800 gate. One new row across all three sources in the last 24 hours; housingsgn's newest is from 2026-09-12. The resurrection sweep, the 20% single-reason ceiling, `delisted_at` and `crawl_runs` telemetry are built. `auto-crawl-v2` is still scheduled; a Supabase support ticket to remove it was filed on 2026-09-28 (item 2). No new sources. |
| S2 realtor identity | Scaffolding done, acquisition short | `realtors` has 34 rows; 84 of 180 active listings resolve to one, 83 have a dialable number (46%, bar 60%). `extract-phone` runs hourly. `source_agent_id` is captured on nhatot only (15 of 40 active), and `realtor_identities` has no rows, so resolution by agent id has never matched. |
| S3 normalization | Done | Canonical columns populated; 157 of 180 active rows shortlistable. `vibe` is out of the response, the style filter reads `styles`, the `$730` rule is asserted in CI, and the title/description price cross-check runs every 30 minutes (#117, #118). |
| S4 intake + handshake | Done, and changed | Intake is `RequestViewingModal`: one button per card, a signed-in user, one credit per listing, 1-5 listings, no today or tomorrow (CLAUDE.md invariants 7-8). The `wa.me` handshake is as planned. WhatsApp is on the Cloud API. |
| S5 ops console | Done | At https://hausto-ops.vercel.app, deployed on merge. Paste-parse is built (`ops-parse-reply`, #108). Its ≥80%-on-30-replies bar is **unmeasured**: no broker reply has been recorded yet. |
| S6 itinerary + delivery | Done | Itinerary with clash warnings, one-message delivery, rules-based intent, reminders and the silence-clock property test landed in #92; substitutes and the agent followed (#94), and all five templates are approved (#101). |
| S7 availability requests | Request built, handling not | The complex page's request is live on WhatsApp for any country's number (#123, #124). Six requests ever, all by email before that. 12 of 23 buildings have no known agent, so S7.0 - agents per building - comes first. Its code is built: the Buildings screen in the ops console and `complex_agents` (SPEC §11). Its work - recruiting agents - is not started. S7.1a is built: requests are worked on the console's Availability screen with typed steps (`inquiry_events`). S7.1b is built: an agent's offered unit becomes a requestable listing, and the one offer message goes from the console. S7.1c is built: offer links link the viewing request back, reminders fire at 16h and 22h, and `request_update` is written and registered but not yet submitted to Meta. S7.1 is done once that template is approved. S7.2a is built: agents are asked on Zalo through the bridge from the Availability screen, capped per agent and per day, and their replies come back to the request. S7.2b - photos from agents and a suggested unit from their reply - is next; both wait on S7.0's recruiting to be used. |

Live traffic so far is one viewing request. The number to watch (below) has no
denominator yet.

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

**2. Realtor phones are NOT resolved. This finding was wrong.**

It originally read "already resolved, 87% of active listings", from the fact
that `contact_phone` is populated on 487 of 696 rows. Populated is not
resolved. Of 495 rows carrying the field, **404 hold a masked value** -
`0775 924 ***`, `098890 ***`, `***`. Counting those as contacts is what
produced the 87%.

What is actually dialable:

| Source | Active | Dialable | Distinct real numbers |
|---|---|---|---|
| batdongsan | 88 | **0** | 0 |
| housingsgn | 33 | 30 | **1** (the agency switchboard) |
| nhatot | 24 | 1 | 1 |

Ten distinct numbers across the whole 696-row index; two across active
listings. `phone_extraction_attempts` is 0 on every row, so `extract-phone`
has never run to completion, and it is on no cron.

Masking is per source and deliberate: batdongsan hides the number behind
"Bấm để hiện số", nhatot masks it in the ad payload. Only housingsgn publishes
one, being a single agency. So acquisition is the work, and it is a day or two
per source, not a regex pass.

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
active on `*/30 * * * *`, both aimed at `scheduled-crawl`. v2 never reaches it -
it is owned by `supabase_read_only_user` and dies inside the database on
"permission denied for function http_post", 96 times in the last two days alone.
It is log noise rather than a live second crawler, and it cannot be unscheduled
by any role available to us - see the comment in
`20260910090000_drop_duplicate_crawl_cron.sql`.

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
   the cover image. Per-source, per-run telemetry - rows attempted, written,
   and rejected with why - landed in #92 (`crawl_runs`), so a run that rejects
   100% of candidates no longer reports success.
2. **Delete one of the two crawl crons.** `auto-crawl-v2` and `auto-crawl-v3` run
   the same function every 30 minutes with different auth. Keep v3, drop v2.
   Still open on 2026-09-28: `auto-crawl-v2` (jobid 7) is owned by
   `supabase_read_only_user`, and nothing available to us can remove it -
   `postgres` is not a superuser and cannot `SET ROLE` to that owner (CLAUDE.md,
   "A migration cannot touch a cron job owned by another role"). A Supabase
   support ticket asking them to run `SELECT cron.unschedule(7)` as
   `supabase_admin` was filed on 2026-09-28. It is harmless meanwhile: every run
   fails inside the database on `permission denied for function http_post`
   (48 of 48 in the preceding 24 hours), so nothing reaches `scheduled-crawl`.
   Done when `SELECT jobid, jobname FROM cron.job WHERE jobname LIKE
   'auto-crawl%'` returns only jobid 13, `auto-crawl-v3`.
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
   Built: `verify-external-listings` re-probes 20 dead nhatot rows per run
   (`resurrectNhatotAds`) and enforces the 20% ceiling.
5. **Add `delisted_at`,** set only when a re-verification confirms the unit is
   gone or the price moved. Decay listings out of search after 21 days without a
   price-confirming re-verification. Keep `deactivated_at` for URL-level death.
   Built, with one correction recorded in SPEC §0: a moved price re-prices the
   listing and stamps `price_confirmed_at`; it does not delist it.
6. **Then, and only then, add sources.** 3-5 expat-facing broker sites in the
   housingsgn mould, then the two or three HCMC expat rental Facebook groups that
   matter - HCMC first because that is where the demand is, not because the other
   cities are out of scope. Chotot is already in - make it produce again rather than re-adding it.
7. ~~Drop Hanoi and Da Nang.~~ **Reversed on 2026-09-11: all three cities stay.**
   The rotation already covers 10 HCMC districts, 7 Hanoi and 3 Da Nang, so
   keeping them is the option that costs nothing - the work was only ever in
   removing them. The one real consequence is that `district_code` (SPEC §0) has
   to cover Hanoi and Da Nang districts, not just the HCMC set, and S3 should
   carry that.

**Done when:** per-source crawl telemetry exists and all three sources have
written rows in the last 24 hours; the 41 recovered rows are live; the
resurrection sweep runs on a schedule and has reactivated its first batch; a
single verification reason cannot silently deactivate more than 20% of a run;
≥800 active listings, with ≥2,000 as the standing target once the leak is closed
and new sources land. Counted across all three cities, since they are all in
scope again - HCMC remains where supply matters most, but it is no longer the
only thing counted.

> v2 targeted 2,000 active as a gate on everything downstream. That target is
> right and unchanged, but gating S3-S6 on it means the ops console does not get
> built until the crawler work lands. 800 is enough to exercise the flow with
> real inventory, so treat 800 as the gate and 2,000 as the goal.

### S2 - Realtor identity (0.5 day scaffolding + acquisition per source)

Re-scoped after finding 2 turned out to be wrong. This was costed as
"normalization, not extraction" on the belief that the phones were already in
hand. They are not, so it splits in two: the scaffolding below is half a day
and real, and acquisition behind it is the actual milestone.

1. Create `realtors` and `realtor_identities` per SPEC §1.
2. Backfill `realtors` from the rows carrying a **dialable** `contact_phone`,
   normalizing to E.164 and collapsing duplicates. That is 82 rows and 10
   brokers, not 487 - `public.normalize_vn_phone` returns NULL for a masked
   value rather than storing a number nobody can ring.
3. Add `source_agent_id` to `external_properties` and populate it from the
   batdongsan seller box during the S1 crawler work, while that code is open.
4. Wire ingest resolution order: agent identity → phone match → NULL and enqueue.

The regex pass over title, description and source_url that v2 specified as step 1
is worth running **once**, over the 209 rows with no `contact_phone`, and then
retiring. It is not a milestone.

**Do not** attempt full coverage. Unresolved listings stay searchable; they need
a contact only when a renter shortlists them, and ops resolves those on demand at
request time. Every on-demand resolution enriches the table permanently.

**Scaffolding done when:** `realtors` and `realtor_identities` exist and are
backfilled; ingest resolves agent identity → phone → NULL; `source_agent_id`
is persisted for every source that exposes one.

**Acquisition done when:** `extract-phone` runs on a schedule and ≥60% of
active listings resolve to a dialable number. Nothing about that is achievable
by normalization - it needs the batdongsan reveal path working, which is what
`extract-phone`'s Browserless branch was built for and has never done.

`/ops/resolve` moves to S5, where the console it lives in gets built.

### S3 - Data normalization (1.5 days)

Canonical columns per SPEC §0: `price_vnd`, `price_confidence`, `bedrooms`,
`bedrooms_is_min`, `area_sqm`, `district_code`.

The live shape of the problem, on 115 active rows:

- `rooms` parses as an integer on **0** of them. Six distinct strings: `'2
  Bedrooms'` (49), `'3 Bedrooms'` (34), `'1 Bedroom'` (15), `'Studio'` (9),
  `'4+ Bedrooms'` (6), `'4 Bedrooms'` (1), null (1).
- `size` parses as a number on **17** of them.
- `location_normalized` is populated on all 115 but is diacritic-stripped prose,
  not a district code. Three active rows normalize to `'h ni'` - Hanoi rows,
  which now stay, so the mapping has to cover all three cities rather than
  assuming HCMC.
- Price: fix the housingsgn USD conversion first, as a source-level rule, before
  building the title/description cross-check. Then flag `price_confidence = LOW`
  where extracted and described prices disagree by more than 15%, and exclude
  `LOW` from shortlisting.

Drop `vibe` from the API response - **after** re-pointing the style filter at
`vibe_analysis->styles` at `public-property-search/index.ts:116` and `:191`. Keep
`style_tags`, `image_highlights`, `amenities`. Extend the response additively;
never break its shape. It serves AI crawlers via llms.txt and will serve the
WhatsApp agent.

Status 2026-09-27: the style filter reads `vibe_analysis->>styles` and `vibe`
is gone from the response; budgets and `price_vnd` in the response read the
canonical column; `canonical-price.test.ts` evaluates the migrated SQL rule in
CI. The title/description cross-check is built: `price-crosscheck` stores the
rent range the text quotes and `price_confidence_for` marks a price more than
15% outside it LOW.

**Done when:** every active listing has a canonical bedroom count, area, district
and VND price; the `$730` row and its class are caught by an assertion in CI, not
by a human reading a table; style filtering still returns the same rows it did
before `vibe` was removed.

### S4 - Request intake and the WhatsApp handshake (3 days)

> Built, then changed (#96 and after): the shortlist and "Book viewing" merged
> into one "Request viewing" button opening `RequestViewingModal`; intake
> takes 1-5 listings, requires a signed-in user, spends one viewing credit per
> listing, and never offers today or tomorrow. The phone number stays the
> identity for everything inbound. See CLAUDE.md invariants 7-8. Since then the
> modal asks for the one place it was opened from, and a place requested while
> an earlier request is still being arranged joins it (`viewing-request-open`,
> `joinRef` on `viewing-request-create`, SPEC §1).

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

### S7 - Availability requests: sourcing a building (added 2026-09-29)

> The request itself is built (#123, #124, SPEC §11): a complex page's "Check
> availability", confirmed by a code on WhatsApp, answered by a person within
> 24 hours, any country's number. What is not built is the handling - how a
> request becomes units the renter can ask to see. This milestone is that.

Treat each request as a **sourcing job with a 24-hour clock**. Software finds,
records and sends; a person, and later the AI operator, does the asking.

**Supply is the bottleneck, not software.** Read from production on 2026-09-29:

- Known agents per building, all time: 12 of 23 published buildings have none -
  Empire City and Celadon, both asked about, among them. 8 have one; the best
  have four.
- Listings do not answer it either: Empire City has had 2 ever, Celadon 3, and
  an ad stays up after its unit is let. Advertised is not available until an
  agent says so.
- `complexes.management_company` says Savills manages 10 of the 23 (all three
  buildings requests have named) and CBRE 6. Their residential leasing teams
  would reach 16 buildings. The column was seeded, so confirm before relying on
  it.

**The handling, per request:**

| When | What | Who |
|---|---|---|
| T0, the code arrives | Confirmation carries any advertised units on file that fit, marked "advertised - we confirm with the agent"; the request brief is assembled | System |
| T0 to T+12h | Ask 3-5 agents for that building: bedrooms, budget, move-in, pets, "photos, price, when can it be seen". Never the renter's identity | Operator, later the AI operator |
| As agents answer | Each offered unit becomes a listing with photos and price, so Request viewing works on it | Operator |
| Before T+24h | **One** WhatsApp message with up to five units, a link each | Operator |
| After | Renter taps a unit, signs in (first viewing free), picks times; S4-S6 take over | Existing flow |

One message, because the confirmation plus one more is the two-in-a-row limit
and the window shuts at T+24h. If nothing is found, that message ends with a
question ("widen to An Phu?") so a reply keeps the thread open.

**S7.0 - Agents for the requested buildings.** Mostly not code. Join each
building's Zalo and Facebook agent groups - a person reads them; the bridge
never reads chats beyond the agents we are talking to - and approach the Savills
and CBRE leasing teams. Code: a `complex_agents` table (building, agent, source
`LISTING | MANUAL | MANAGEMENT`, last reply) and an "add agent to building"
action in the ops console, reusing `RECORD_CONTACT`'s upsert by `toE164`.

**S7.1 - The concierge workbench.** Agents still messaged by hand on Zalo, as
the viewing flow was before the bridge.

1. Move the queue from Admin Tools into the ops console: it touches agents, and
   the SPA must not carry their contacts. It also drops the renter's name and
   phone from the operator's view (invariant 4), whoever works it.
2. Request brief: criteria, matching listings on file with their agents, the
   building's roster, its management company, the window deadline.
3. Typed steps, not free text - `inquiry_events`, append-only, status derived
   by a reducer: `ASK_AGENT`, `AGENT_ANSWERED` (no units / units),
   `CAPTURE_UNIT`, `OFFER_UNITS`, `CLOSE` (viewing requested / nothing found /
   renter went quiet / rented elsewhere / lease signed). Invariants 1 and 2,
   applied to sourcing: it is the record later automation learns from.
4. Unit capture: a form creating an `external_properties` row with
   `source = 'concierge'` and every field `screenCandidates` requires, plus
   photos. No schema change. `verify-external-listings` must skip these rows
   (today an unknown source is marked `error` and never deactivated), and a
   daily job expires them after 14 days unless reconfirmed.
5. Offer composer: pick units, preview the one message, send through
   `sendConciergeWhatsApp`, record `OFFER_UNITS`.
6. Handoff: offer links carry `?inq=`, stored as an additive
   `viewing_requests.inquiry_id`; the request closes itself as viewing
   requested - the conversion number.
7. Deadline jobs at T+16h and T+22h alert the operator if nothing has gone out.
8. Submit a Utility template, `request_update`: "Hi {{1}}, we have an update on
   your request for {{2}}. Reply here to see it." It closes the gap after the
   window shuts. Registry entry `approved: false` until Meta says otherwise.

**S7.2 - Outreach through the bridge.** `realtor_messages.request_id` becomes
nullable beside a new `inquiry_id` (exactly one set) and an
`AVAILABILITY_CHECK` purpose. The bridge's watch list and reply routing learn
inquiry-scoped messages - today such a reply is dropped, since routing and the
watch list both come from `request_items`. The device forwards photos from
watched agents only (today it forwards text). Replies get a suggested
unit parse the operator confirms, as `ops-parse-reply` does. Cap first-time
agents per day and messages per agent: cold messages from a personal Zalo
account are the likeliest way to lose it.

**S7.3 - The AI operator sources alone.** A new `ASK_AGENTS` action with its
own gate, measured from how often operators sent its S7.2 proposals unchanged
(invariant 10). The offer message stays human-approved longest - it is the
promise to the renter. Start when requests pass about five a week.

**Holes, and how they are closed:** units let fast (14-day expiry; the offer
says "available as of <date>"); bad photos or prices from agents (a person
approves every captured unit through S7.2); units that cannot be requested (the
capture form demands what intake checks); a renter who goes quiet (close after
7 days, alerts run to the watch's end); weekends with one person (the deadline
jobs help, but "24 hours" needs someone on call or a different promise).

**Charging:** the request stays free; viewing credits are spent as now. The
natural revenue is agent-side - HCMC agents commonly pay a referral share of the
landlord's commission on a signed lease - and needs only the `CLOSE` reason
"lease signed" to track. No new payment surface (CLAUDE.md).

**Done when:** a request for a building with a roster goes code → brief → agents
asked → units captured → one offer message → a viewing request linked back to
it, driven by buttons on `MockAdapter` with seeded data; every step is a typed
event with reducer tests including out-of-order arrival; and no request can
pass T+24h without either an offer or a deadline alert, asserted as a property
test.

**The numbers to watch:** time to first offer (under 24h, always); share of
requests with at least one unit offered, per building - the supply number;
offer-to-viewing-request conversion; agent reply rate, to prune the roster.

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
- Availability requests on WhatsApp, added 2026-09-28/29 (SPEC §11): the
  complex page's concierge request ends on WhatsApp, where a person replies
  within 24 hours, and sets a watch that alerts new listings at the building
  through the digest's sweep. The sweep's cron now sends rather than dry-runs.

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

> **Superseded on 2026-09-27.** The owner chose a Zalo bridge - a daemon on an
> always-on device driving the business's Zalo account through zca-js
> (`bridge/`) - knowing it automates a personal account against Zalo's terms.
> It skipped the Chrome-extension step below and went straight to sending
> without a click, behind the AI operator's locks. What was built instead, and
> the limits it runs under, is SPEC §10 and `bridge/README.md`. The table and
> sequence below are the reasoning as it stood on 2026-09-10; the risk they
> name is the one that was accepted.

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
- Renter accounts beyond a phone-keyed session. *Changed:* intake now requires
  Supabase sign-in, because a request spends viewing credits and credits belong
  to an account. `renters.user_id` links the two and is nullable; the phone is
  still the identity for everything inbound.
- Any Zalo integration. *Changed 2026-09-27:* the Zalo bridge is the one
  exception (see above). Zalo OA/ZNS stays out - it needs a Vietnam-registered
  entity.
- Geocoding the index. Zero active rows had coordinates (17 of 180 do on
  2026-09-28) and the viewing flow does not need them. Do not let
  `batch-geocode-properties` become S1.
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
S7 (added later) starts with S7.0, which is agent recruiting rather than code,
and its later stages wait on volume rather than days.

Roughly **11 working days**, down from v2's 15 - the saving is entirely S1 and S2
no longer building what exists. S5 is the one milestone not to compress.

S1 gates S3 only on the 800-listing threshold, and S3 onward can start against
the recovered index while new sources are still landing.

Launch is gated on Meta Business verification and on having a Vietnamese-speaking
operator who has already run 10 requests by hand. Start both today; neither is
code.

As of 2026-09-28 the first gate is passed - the number is live on the Cloud API
with all five templates approved. The second is not: one viewing request has
been filed, and the AI operator's stage 1 record, which was meant to be built
from those hand-run requests, has no decisions in it.

## The number to watch

Confirmed-available rate: of the listings a renter shortlists, what share does
ops confirm as actually available at the stated price. Below ~40% and the answer
is never a better booking flow - it is a better index.

Second number, for S1 only: **active rows written per source per day.** It would
have caught nhatot 35 days ago.
