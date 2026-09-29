# SPEC - viewing coordination domain model

Status: authoritative, and built. Written 2026-09-10 alongside
`docs/PLAN-v3.md`; last brought up to date with the code on 2026-09-28.

A renter shortlists 1-5 crawled rentals and requests viewings. An operator -
a person, and since stage 2 of §10 an AI operator acting within locks -
confirms availability with each realtor over Zalo. The system assembles an
itinerary and delivers it over WhatsApp. The renter confirms with one tap.

The renter never talks to a realtor. The realtor never sees the renter's contact
details. Everything crosses through us.

Everything here is live in production: WhatsApp has run on the Cloud API since
2026-09-18 (`docs/whatsapp-go-live.md`), and the Zalo bridge of §10 on the
business's account since 2026-09-27. Everything in §0 is additive to the live
listing schema; §1 onward is new tables.

---

## §0 Additive columns on existing tables

The live listing table is `public.external_properties` (696 rows, 115 active).
Do not restructure it. Add only:

| Column | Type | Why |
|---|---|---|
| `price_vnd` | `integer` | Canonical. `price` is `numeric` and holds USD for housingsgn rows (a live row reads `price = 730`, `price_display = '$730 / month'`). Convert on write; never read `price` for money decisions. |
| `price_confidence` | `text` | `HIGH` / `LOW`, set by the trigger through `price_confidence_for(price_vnd, described_price_min_vnd, described_price_max_vnd)`. `LOW` when the price is outside 1M-500M, or more than 15% outside the range the title or description quotes. `LOW` rows stay searchable but cannot be shortlisted. |
| `described_price_min_vnd`, `described_price_max_vnd` | `integer` | The lowest and highest monthly rent the title and description quote, read by `_shared/price-mentions.ts` and stored by `price-crosscheck` every 30 minutes over active rows. NULL when the text quotes none. A range, not one figure: an advert naming several units does not say which this row is, so any price inside it agrees. The reader skips deposits, fees, utilities, discounts, starting prices, nightly/yearly/per-m² rates and sales, because a figure it invents makes a real listing unrequestable while one it misses costs nothing. |
| `bedrooms` | `smallint` | `rooms` is free text: `'2 Bedrooms'`, `'Studio'`, `'4+ Bedrooms'`. Zero of 115 active rows parse as a bare integer. `Studio` maps to `0`. |
| `bedrooms_is_min` | `boolean` | True for `'4+ Bedrooms'`, so a `= 4` filter does not silently claim precision. |
| `area_sqm` | `numeric` | `size` is free text; 17 of 115 active rows are numeric. |
| `district_code` | `text` | Parsed from raw `location` by `public.vn_district_code(city, location)`, which is the authority - the codes are not enumerated here because they drift. Scoped by `city`: district names collide across cities, so this is unique on `(city, district_code)`, never on `district_code` alone. **Not** parsed from `location_normalized`, which deletes accented characters rather than folding them (`Bình Thạnh` → `bnh thnh`) and cannot be matched against. |
| `source_agent_id` | `text` | The broker's profile id on the source site. The durable join key for realtor identity - see §1. Free on nhatot (`account_oid`), and the half of identity that does not have to be bought: the phone usually needs a reveal, this arrives with the ad. |
| `realtor_id` | `uuid` | Resolved broker, nullable. Set at ingest in the order agent identity → phone → NULL. A NULL here is normal and not a defect: a listing needs a contact only once a renter shortlists it. |
| `delisted_at` | `timestamptz` | Distinct from `deactivated_at`. Set when a re-verification **confirms** the unit is gone - the listing's own source saying so, twice - or when it goes 21 days without a price confirmation. A URL that merely failed to resolve sets `deactivated_at` only; on nhatot that is routinely wrong, since expired ads come back under the same id when the seller reposts. |
| `price_confirmed_at` | `timestamptz` | When the listing's price was last read back from the source and still matched. Only set by sources whose price can be re-read (today: nhatot, whose ad payload carries it), and left NULL elsewhere rather than filled with a check that was never run. `last_verified_at` only ever meant "the URL resolves", which is not the question ops needs answered. |
| `contact_phone_e164` | `text` | Generated: `normalize_vn_phone(contact_phone)`, stored. NULL for a masked value (`0775 924 ***`) rather than a number nobody can ring, so it is what "has a dialable contact" means. `extract-phone` works through active rows where it is NULL. |

`price_vnd`, `bedrooms`, `area_sqm` and `district_code` are NOT NULL for any row
eligible for shortlisting. Enforce with a partial index, not application code.

**`price` carries two currencies and only its magnitude says which.** housingsgn
quotes USD, and the display is not a reliable tell - a live row reads
`price = 12500000, price_display = '$500/month'`, already converted with the
display never updated. Converting on a `$` in the display turns that into 312
billion dong. The threshold sits in the gap between the currencies, not at the
edge of one: below 100,000 is USD, at or above it is dong. A rent of
`2800000` ('2,8 triệu/tháng') is real and cheap, and any threshold near 3
million misreads it.

**Coverage is partial and that is expected.** On the 145 active rows when this
was first measured: bedrooms 144, price 145, district 129, area 124 - **107
shortlistable on all four**. On 2026-09-28 it was 157 of 180 active rows,
counting the `price_confidence` bar as well. The
losses are listings whose source never published an area, and addresses that
degrade to a bare 'Hồ Chí Minh'. A row missing any of the four is searchable
but not shortlistable, which is the point of the partial index rather than a
defect to chase to zero.

**A moved price re-prices the listing; it does not delist it.** The plan's
original wording treated a changed price as evidence the unit was gone. It is the
opposite: the seller re-priced and the unit is still on offer, so verification
updates `price`/`price_display` and stamps `price_confirmed_at`. What must never
happen is ops quoting a figure the broker has already changed - the mismatch
`price_vnd_at_request` (§1) exists to catch, and should not have to.

`vibe` is gone from the `public-property-search` response (#117). It was
non-null on 28 of 115 active rows and carried no signal `style_tags` does not.
The style filter used to read it via `ilike`; it now reads
`vibe_analysis->>styles` (a case-insensitive substring match, as before), and
budgets and the emitted `price_vnd` read the canonical column rather than
`price`. `style_tags`, `image_highlights` and `amenities` stay. The response
shape is otherwise unchanged - it is a stable contract.

---

## §1 New entities

### `realtors`

Keyed on `phone_e164` (unique). One row per human broker.

```
id              uuid pk
phone_e164      text unique not null      -- +84...
display_name    text
agency          text
language        text default 'vi'
notes           text                      -- ops free text, never parsed
created_at      timestamptz default now()
```

### `realtor_identities`

Attaches a broker to their identity on a source, so one resolution permanently
covers every future listing from them.

```
realtor_id      uuid references realtors(id)
source          text                      -- batdongsan | nhatot | housingsgn
source_agent_id text
primary key (source, source_agent_id)
```

Resolution order at ingest: `source_agent_id` match → `phone_e164` match → NULL
and enqueue for on-demand resolution.

Unresolved listings stay searchable. They need a contact only when a renter
shortlists them, and ops resolves those at request time. Every on-demand
resolution enriches the table permanently. Do not chase full coverage.

### `renters`

```
id                        uuid pk
phone_e164                text unique not null      -- CHECK '^\+[1-9][0-9]{6,14}$', any country
display_name              text
user_id                   uuid references auth.users -- nullable, unique when set
service_window_expires_at timestamptz    -- see §5
opted_out_at              timestamptz
digest_opt_in_at          timestamptz    -- weekly digest consent, default NULL
created_at                timestamptz default now()
updated_at                timestamptz default now()
```

The phone is the identity for everything inbound, because a WhatsApp message
arrives with nothing else to key on. `user_id` links it to the Supabase account
that filed a request (intake requires one, since a request spends that
account's viewing credits); RLS lets a signed-in user read their own renter
row, requests and items through it. It is nullable because a renter who
arrived over WhatsApp and never signed up is still a renter.

`digest_opt_in_at` is deliberately separate from `opted_out_at`: a viewing
request is not consent to a weekly marketing message.

### `viewing_requests`

One per renter intake. Status is **derived** - see §3.

```
id              uuid pk
ref             text unique not null      -- short human ref, e.g. HV-4KX2
renter_id       uuid references renters(id)
availability    jsonb not null            -- chosen windows, Asia/Ho_Chi_Minh
created_at      timestamptz default now()
```

### `request_items`

One per requested unit. 1-5 per request, arriving together or one at a time
as the renter joins places to it (below). Status is **derived**.

```
id                   uuid pk
request_id           uuid references viewing_requests(id)
listing_id           uuid references external_properties(id)
realtor_id           uuid references realtors(id)   -- nullable until resolved
price_vnd_at_request integer not null               -- what the renter was shown
sort_order           smallint                       -- ops-ordered itinerary position
```

`price_vnd_at_request` is what makes "the broker quoted a different price" a
detectable event rather than an argument. It is read from the listing row at
intake, never taken from the request body - the renter's client says *which*
listings, never what they cost.

**The intake contract** (implemented in `_shared/viewing/intake.ts`, which is
the single source for all of it):

- `ref` is `HV-` plus four characters from `34679ACDEFGHJKLMNPQRTWXY`. The
  alphabet drops everything that survives being read aloud badly - I/1, O/0,
  S/5, Z/2, U/V, B/8 - because an operator types these back from a phone call.
- `availability` is `[{date, part}]`, `date` a local calendar date in
  Asia/Ho_Chi_Minh and `part` one of `MORNING` / `AFTERNOON` / `EVENING`. Chips,
  not a datetime picker: what time on Tuesday is the broker's to answer, and
  naming one at intake is promising a slot we cannot honour (§6). At most six,
  at most `MAX_DAYS_AHEAD` (14) days ahead, and never today or tomorrow:
  `MIN_LEAD_DAYS` is 2, because an operator has to reach every agent by hand
  and wait for each to answer. Both rules live in `intake.ts` rather than the
  date picker, so a client cannot offer a window the function will refuse.
- A shortlisted listing must clear the §0 gate - active, `price_vnd`,
  `bedrooms`, `area_sqm` and `district_code` all present, `price_confidence`
  not `LOW`. Screening happens at submit rather than at shortlist time, because
  verification runs every 20 minutes and can deactivate a row in between. A
  listing that falls through is reported to the renter by name; the request
  proceeds on the rest as long as `MIN_ITEMS` (1) survives.
- Intake requires a signed-in user and charges one viewing credit per listing
  through `consume_viewing_credits()`, called last, after the log is written;
  if the charge raises, the request is deleted. See the Payments section of
  `CLAUDE.md` for why it is a call and not a trigger, and why
  `viewing_listings_booked_since()` counts both request tables.
- Once charged, everyone with the `ops` role is emailed the new request
  (`_shared/viewing/ops-alert.ts`, §4). Nothing is sent to the renter (§5).

**One place at a time, one plan.** The renter modal asks for one listing, the
one it was opened from. A renter who wants three seen requests from three
cards, and the second and third **join the first request** rather than each
opening their own - otherwise they would get three itineraries, three billed
messages (§5) and no clash warning between viewings that were never in the
same plan. `pickJoinable` in `intake.ts` decides which request is open to
join:

- its derived state is `SUBMITTED` or `CONTACTING` and nothing has been
  delivered - once assembly starts, the renter has been told, or is about to be
  told, the plan;
- it has fewer than `MAX_ITEMS` places;
- at least one of its windows is still at least `MIN_LEAD_DAYS` away, since the
  new agent is asked about the request's windows, not new ones;
- the most recent such request for the signed-in account (`renters.user_id`),
  not counting opted-out numbers.

A joining place takes the request's windows and WhatsApp thread, so the modal
asks for neither. The renter can choose different times instead, which makes it
a request of its own. `viewing-request-open` tells the modal which request it
would join; `viewing-request-create` decides again at submit (with `joinRef`)
and answers `409 join_closed` if that request has moved on, rather than
quietly opening a different one. A join writes only `ITEM_ADDED` (and
`REALTOR_RESOLVED` where known) through the same `itemEvents` builder a new
request uses, so the planner, console and itinerary cannot tell the
difference. It charges one credit per place and undoes by deleting the new
items, whose events cascade with them. The ops alert says "1 more place added".

### `events`

Append-only. The single source of truth for all state. See §3.

```
id           bigserial pk
request_id   uuid not null
item_id      uuid                         -- null for request-level events
type         text not null                -- SCREAMING_SNAKE, see §3
payload      jsonb not null default '{}'
actor        text not null                -- OPS:<uuid> | RENTER | SYSTEM | AGENT:<version> (§10)
occurred_at  timestamptz not null default now()
```

No `UPDATE` and no `DELETE` on this table. Revoke both at the role level, so the
constraint is enforced by Postgres rather than by code review.

### `messages`

Every outbound and inbound message. Persisted before send, always.

```
id              uuid pk
request_id      uuid
direction       text not null             -- OUT | IN
channel         text not null             -- WHATSAPP
to_phone        text not null
body            text
template_name   text                      -- set iff sent as a template
status          text not null             -- QUEUED | SENT | DELIVERED | READ | FAILED
idempotency_key text unique not null
provider_id     text
error           text
created_at      timestamptz default now()
sent_at         timestamptz
```

### `realtor_messages`

The broker transcript: every message to and from a realtor about an item.
Written only through `_shared/realtor/send.ts`, which persists before a message
counts as sent, keys every row for idempotency, and refuses any outbound body
carrying a phone number or this request's renter's name (§6). Ops and admin
read it; nothing in a browser writes it.

```
id              uuid pk
request_id      uuid not null
item_id         uuid
realtor_id      uuid
direction       text not null             -- OUT | IN
medium          text not null             -- ZALO | PHONE | WHATSAPP | SMS
purpose         text not null             -- REQUEST_VIEWING | NUDGE | CONFIRM | RELEASE | REPLY
body            text not null
status          text not null             -- QUEUED | SENT | FAILED | RECEIVED
actor           text not null             -- OPS:<uuid> | AGENT:<version> | SYSTEM | BRIDGE
idempotency_key text unique not null
provider_id     text
error           text
claimed_at      timestamptz               -- bridge lease, §10 stage 3
on_sent_event   jsonb                     -- the event written when the bridge acks SENT
created_at      timestamptz default now()
sent_at         timestamptz
```

This is the corpus §4 exists to produce. A broker's reply (`IN`) is stored
verbatim and never parsed; the `OUTCOME_RECORDED` read from it points back at it
by `reply_message_id`. That pair - their words, our typed reading of them - is
what paste-parse and any later automation are trained and measured against.

The transport is `_shared/realtor/channel.ts`, split from the rules the same
way `WhatsAppAdapter` is, and chosen by the `REALTOR_CHANNEL` secret:

- `ManualChannel` (unset or `manual`): the operator sends on Zalo from their own
  phone and presses "Mark sent", so by the time it is called the message has
  already left.
- `BridgeChannel` (`bridge`, production since 2026-09-27): the row is left
  `QUEUED` for the Zalo bridge device to send, and the event it stands for waits
  in `on_sent_event` until the device acks it. See §10 stage 3.

Zalo OA/ZNS is not built: it needs a Vietnam-registered entity.

### `jobs`

Timers and nudges, drained by `pg_cron`. No Inngest, Trigger.dev, BullMQ, Redis.
Volume is ~25 requests/day.

```
id           uuid pk
kind         text not null
run_after    timestamptz not null
payload      jsonb not null default '{}'
attempts     smallint default 0
locked_at    timestamptz
completed_at timestamptz
last_error   text
created_at   timestamptz default now()
```

`viewing-jobs-drain` decides what is owed and enqueues; `viewing-jobs-run`
claims rows (`claim_jobs`) and runs them. Both are on `pg_cron`.

---

## §2 Lifecycle

Request states, derived: `DRAFT` → `SUBMITTED` → `CONTACTING` → `ASSEMBLING` →
`DELIVERED` → `CONFIRMED` | `FAILED_NO_SUPPLY` | `CANCELLED`.

Item states, derived: `PENDING` → `CONTACTED` → one of `CONFIRMED`,
`ALTERNATIVE_OFFERED`, `UNAVAILABLE`, `ALREADY_RENTED`, `PRICE_CHANGED`,
`NO_RESPONSE`, `UNREACHABLE`.

**Partial success is the happy path.** Three confirmed of five requested is the
normal outcome. Any function signature or UI state that assumes all items resolve
the same way is wrong. `FAILED_NO_SUPPLY` means *zero* items confirmed, and it
ships with substitutes, never on its own.

A request moves to `ASSEMBLING` when every item has left `PENDING`/`CONTACTED`,
or when the assembly deadline fires - whichever comes first. Ops can force it.

An `ITEM_ADDED` that arrives while a request is `ASSEMBLING` (a place joining
it, §1, raced against an operator assembling) moves it back to `CONTACTING`:
the order on file no longer covers every place. From `DELIVERED` on, it moves
nothing - intake never joins those.

---

## §3 The event log and the reducer

**All state transitions go through the event log.** Every status field on
`viewing_requests` and `request_items` is derived by a reducer over events, never
written directly. If you are writing `UPDATE request_items SET status = ...`
outside the reducer, stop.

Event types:

| Type | Level | Payload |
|---|---|---|
| `REQUEST_SUBMITTED` | request | `{availability}` |
| `ITEM_ADDED` | item | `{listing_id, price_vnd_at_request}` - at intake, or later when a place joins an open request (§1). Moves `ASSEMBLING` back to `CONTACTING` (§2) |
| `REALTOR_RESOLVED` | item | `{realtor_id, method}` - `method` ∈ `AGENT_ID`, `PHONE`, `MANUAL` |
| `REALTOR_CONTACTED` | item | `{channel, draft_id}` - `draft_id` is the `realtor_messages` row sent, or null |
| `OUTCOME_RECORDED` | item | `{outcome, slots[], actual_price_vnd, note, reply_message_id?, suggested?}` - see §4 |
| `ITEM_NUDGED` | item | `{attempt, message_id?}` |
| `REALTOR_NOTIFIED` | item | `{decision, message_id}` - `decision` ∈ `CONFIRM`, `RELEASE`. Moves no state; sets `notified` on the item view |
| `ITINERARY_ASSEMBLED` | request | `{ordered_item_ids[], warnings[]}` |
| `ITINERARY_DELIVERED` | request | `{message_id}` |
| `HOLDING_UPDATE_SENT` | request | `{message_id}` - something the renter heard that was not the itinerary |
| `SUGGESTIONS_OFFERED` | request | `{listing_ids[], source, message_id}` - listings put in front of the renter, in the order shown (today `source: SUBSTITUTES`). What a reply of "2" resolves against (`selection.ts`); answers a waiting `SEARCH` or `SELECTION` (§4). No state |
| `RENTER_REPLIED` | request | `{intent, message_id, handshake?}` - `intent` ∈ `CONFIRM`, `DECLINE`, `RESCHEDULE`, `QUESTION`, `SELECTION`, `SEARCH`, `OPT_OUT`, `UNKNOWN`. `handshake: true` on the first ref-carrying message, which answers nothing |
| `REPLY_SENT` | request | `{message_id}` - an operator's free-text WhatsApp reply. Moves the silence clock (§9) and clears waiting replies; no state |
| `REPLIES_ACKNOWLEDGED` | request | `{message_ids[]}` - replies read and judged to need no answer. Clears waiting replies; no state, no clock |
| `REQUEST_CONFIRMED` | request | `{confirmed_item_ids[]}` |
| `REQUEST_CANCELLED` | request | `{reason, note?}` - `reason` ∈ `CANCEL_REASONS` (`RENTER_DECLINED`, `RENTER_FOUND_PLACE`, `RENTER_UNRESPONSIVE`, `DUPLICATE`, `OTHER`); who cancelled is the event's `actor` |
| `REQUEST_FAILED` | request | `{reason, substitute_listing_ids[]}` |

Reducer rules:

- **Order by `occurred_at`, then `id`.** `id` breaks ties, so replay is
  deterministic under identical timestamps.
- **Out-of-order arrival must not corrupt state.** A `REALTOR_CONTACTED` that
  lands after its `OUTCOME_RECORDED` is ignored, not applied. Every reducer test
  runs its event list forwards, backwards, and shuffled, and asserts the same
  terminal state.
- **Unknown event types are ignored, not thrown on.** A newer writer must not
  break an older reader mid-deploy.
- The reducer is pure: `(events) => state`. No I/O, no clock reads. Pass `now`
  in if a rule needs it.
- `HOLDING_UPDATE_SENT` moves no state. It exists for the silence clock in §9
  and nothing else: telling a renter we are still working is not progress, and
  a request that could be kept alive by saying so would never look stuck.

**Intent is a closed set, classified by rules rather than a model**
(`_shared/viewing/intent.ts`). Every inbound inside the service window is
billed from 2026-10-01, so a one-word "yes" that costs an LLM call to read is a
line item on nothing. `UNKNOWN` routes to an operator, and the rate of
`UNKNOWN` is the evidence for whether a model ever earns its cost.
`CONFIRM` and `OPT_OUT` are the only intents the system acts on unaided.

**Opt-out is matched before diacritics are folded.** `dừng` ("stop") and `đúng`
("that's right") both fold to `dung`. Strip the marks and honouring an opt-out
and opting out a renter who just agreed become the same code path, so the
keyword list in `_shared/whatsapp/inbound.ts` is matched against the raw text
and is the only copy of it.

Enum values are SCREAMING_SNAKE in the DB, mirrored as TS union types derived
from a single source: the `as const` arrays in
`supabase/functions/_shared/viewing-domain.ts`, alongside the reducer. It lives
under `_shared` rather than `src/` because the edge functions are the writers
and cannot import across the SPA boundary at deploy time; the ops console
imports it from there.

---

## §4 Ops actions

**Operators never free-text an outcome.** The console exposes exactly these
seven, each writing one `OUTCOME_RECORDED` event. Free text goes in `note`,
which is never parsed and never affects state.

This constraint is the whole point. It is how we generate the training data to
automate the realtor side later. A text box that changes state destroys the
corpus.

| Action | `outcome` | Requires | Item state |
|---|---|---|---|
| Confirmed a slot | `CONFIRMED` | ≥1 slot | `CONFIRMED` |
| Offered other times | `ALTERNATIVE_OFFERED` | ≥1 slot | `ALTERNATIVE_OFFERED` |
| Not available then | `UNAVAILABLE_DATE` | - | `UNAVAILABLE` |
| Already rented | `ALREADY_RENTED` | - | `ALREADY_RENTED` |
| Different price | `PRICE_CHANGED` | `actual_price_vnd` | `PRICE_CHANGED` |
| No response | `NO_RESPONSE` | ≥2 prior `ITEM_NUDGED` | `NO_RESPONSE` |
| Wrong or dead number | `UNREACHABLE` | - | `UNREACHABLE` |

`slots[]` are UTC instants with an explicit duration. `UNREACHABLE` also enqueues
the listing for realtor re-resolution.

**Paste-parse.** Each card carries a box where the operator pastes the broker's
Zalo reply. An Edge Function calls the LLM and returns
`{outcome, slots[], actual_price_vnd, note}` pre-filled into the form above. The
operator confirms with one click and can override every field. The LLM never
writes an event directly - interpretation is suggested, never applied. This is
where throughput comes from: interpretation is the slow part, not typing.

Built as `ops-parse-reply` over `_shared/viewing/parse-reply.ts`. The model
reports only what the agent said (`AVAILABLE` with times, `NOT_AT_THOSE_TIMES`,
`ALREADY_RENTED`, `WRONG_PERSON`, `UNCLEAR`, a quoted price); deterministic code
maps that to an outcome, because two rules are ours: a time inside the renter's
windows (`DAY_PART_HOURS` / `withinWindows` in `intake.ts`, morning 08-12,
afternoon 12-17, evening 17-21) is `CONFIRMED` and outside them
`ALTERNATIVE_OFFERED`; a quoted price more than 3% from `price_vnd_at_request`
is `PRICE_CHANGED`, slotless, whatever times came with it. It never suggests
`NO_RESPONSE`. What it suggested is stored on the `OUTCOME_RECORDED` the
operator writes, as `suggested {outcome, slot_starts, actual_price_vnd,
confidence, model}`, so agreement with the operator is measurable on live
traffic. The reducer never reads it.

Slots are not limited to the renter's windows: the operator can add any date
and time the agent named, in Ho Chi Minh City time, with a length of 30-90
minutes.

### The rest of the operator's actions

Everything an operator can do is one call in `_shared/viewing/ops-actions.ts`,
reached through `ops-record-outcome` (which only proves the `ops` role and stamps
`OPS:<uuid>`). It lives in `_shared` so it is tested against the in-memory
database, and because it is the AI operator's tool list: the agent calls the
same actions under `AGENT:<version>`, never a second implementation.

| Action | Level | Writes |
|---|---|---|
| `CONTACTED` | item | `realtor_messages` OUT row (the words actually sent), `REALTOR_CONTACTED` |
| `NUDGE` | item | OUT row, `ITEM_NUDGED`; completes `NUDGE_REALTOR` jobs |
| `REALTOR_REPLY` | item | IN row only - a reply that settles nothing yet |
| `OUTCOME` | item | optional IN row, `OUTCOME_RECORDED` with `reply_message_id` |
| `RECORD_CONTACT` | item | `realtors` (by E.164), `request_items.realtor_id`, `REALTOR_RESOLVED {method: MANUAL}`; enriches `external_properties.realtor_id` and `realtor_identities`; completes `RESOLVE_REALTOR` |
| `NOTIFY_REALTOR` | item | OUT row, `REALTOR_NOTIFIED`; refused unless the log says that decision is owed |
| `REPLY` | request | `messages` via `sendFreeForm` (window and 3-in-a-row rules apply), `REPLY_SENT` |
| `ACK_REPLIES` | request | `REPLIES_ACKNOWLEDGED`; refused when nothing is waiting |
| `CANCEL_REQUEST` | request | `REQUEST_CANCELLED {reason, note?}`; completes open `CONFIRM_REALTOR`, `NUDGE_REALTOR` and `RESOLVE_REALTOR` jobs. Refunds nothing - credits paid for an operator's time, and a refund is a payments decision |

A new request emails everyone with the `ops` role (`_shared/viewing/ops-alert.ts`,
from `viewing-request-create` after the charge, never blocking it): the ref, the
place count, the windows and a console link, and nothing about the renter.

**A broker is owed the renter's decision once the request closes**
(`realtorDecisionsOwed` in `reminders.ts`): `CONFIRM` for an item the renter
kept that reached `CONFIRMED`, `RELEASE` for any other item still holding time
(`CONFIRMED`, `ALTERNATIVE_OFFERED`, `CONTACTED`). A broker who said no is
holding nothing and is owed nothing. It stays owed until the broker's most
recent `REALTOR_NOTIFIED` matches, so a broker confirmed on Monday for a request
cancelled on Tuesday is owed a release. The drain turns each into a
`CONFIRM_REALTOR` / `RELEASE_REALTOR` job, which stays open until an operator
sends it.

**Waiting replies** (`waitingReplies` in `thread.ts`) are the renter's replies
whose intent needs an operator, since the last `REPLY_SENT` or
`REPLIES_ACKNOWLEDGED`. `SUGGESTIONS_OFFERED` answers a waiting `SEARCH` or
`SELECTION`, and nothing else. They rank a request to the top of the queue,
closed or not.

---

## §5 Messaging contract

**Every outbound message is persisted before it is sent.** Write to `messages`
with `status='QUEUED'`, then send, then update. Never send first. Idempotency key
on every send, derived from `(request_id, purpose, attempt)` so a retry cannot
double-send.

The Cloud API 24-hour customer service window is a real constraint:

- `renters.service_window_expires_at` is updated on every inbound message.
- `sendFreeForm()` **throws** if the window is closed. It does not silently fall
  back to a template.
- Re-opening a closed window requires `sendTemplate()`, which accepts only names
  from the approved registry in `_shared/whatsapp/templates.ts` - and, since
  `whatsapp-template-sync` caches Meta's live status hourly, only while Meta
  still says `APPROVED`.
- From 2026-10-01 Meta bills service and utility messages sent inside the window.
  Consolidate: one message carrying a full itinerary, not a sequence of turns.
  **Any code path that sends 3+ messages in a row to the same renter is a bug.**

Adapter: `_shared/whatsapp/adapter.ts` exports a `WhatsAppAdapter` interface
with two implementations - `MockAdapter` (the default in dev and in all tests,
rendering in `/dev/phone`) and `CloudApiAdapter` (`WHATSAPP_MODE=cloud`, which
production has run on since 2026-09-18). The rules above live once, in
`_shared/whatsapp/send.ts`, so swapping transports cannot change them.

**Nothing is sent at intake, and that is not an omission.** There is no service
window until the renter messages us first, and no approved template to open one
with. So the confirmation page hands them a `wa.me` link whose prefilled text
carries their ref; sending it is what opens the window and makes everything
afterwards sendable. The webhook routes that first message by the ref it
carries, falling back to the renter's newest request for a bare reply - and to
nothing at all for a ref that does not resolve, since attaching a message to the
wrong thread is worse than attaching it to none.

`/dev/phone` is backed by the `dev-phone` function, which takes the same inbound
path Meta's delivery does (`_shared/viewing/routing.ts`, shared by both) and
refuses to run when `WHATSAPP_MODE=cloud` - an unauthenticated endpoint that
fabricates inbound messages is a forgery tool the moment the number is real. It
renders the window state and the consecutive-outbound count alongside the
thread, because those are what decide whether the next send is legal.

---

## §6 Privacy

**Never expose a renter's phone number or name to the ops console realtor view,
and never put a realtor's phone number in renter-facing output.**

Enforce at the query layer, not the template layer. The ops realtor view reads
from a view that does not select `renters.phone_e164` or `renters.display_name`
at all, so a careless template change cannot leak one. Renter-facing itinerary
rendering takes a DTO with no realtor contact field on it.

The console reads the renter's WhatsApp thread through `ops_request_thread()`, a
`SECURITY DEFINER` function that returns bodies, times, the window expiry and
the consecutive-outbound count - never `to_phone`, never a name - and masks
phone-shaped text inside bodies (`mask_phone_numbers()`: Vietnamese shapes, any
number written with a country code, and this renter's own number however they
wrote it). The console still has no grant on `messages` or `renters`.

Free text is where shape stops protecting anyone, so it is checked on the way
out by the server (`_shared/viewing/privacy.ts`, `assertNoRenterIdentity`): a
broker-bound message may not carry any phone number - Vietnamese-shaped or
written with a country code - nor this renter's number in their own national
format, nor their name; an operator's reply to a renter may not carry a
Vietnamese number, since agents are Vietnamese.

Renters may be on any country's number (§1, `toRenterE164`, `waIdToE164`);
agents are Vietnamese only (`toE164`). Every check above is written for a renter
from anywhere - stripping `+84` to find "the local number" is the mistake that
once meant a foreign renter's number was never checked.

**No `booking` vocabulary in renter-facing copy until state is `CONFIRMED`.** Use
"request". We cannot honour a booking at intake time.

---

## §7 Conventions

- Money in VND, stored as integer dong. Never floats. Display `15.000.000 ₫`.
- All timestamps stored UTC, displayed `Asia/Ho_Chi_Minh`.
- Phone numbers stored E.164. Normalize at every boundary - the crawler hands
  you `0901234567`, `84901234567` and `+84 90 123 45 67` for the same human.
  Agents are `+84` only (`toE164`); renters may be any country (`toRenterE164`
  for what they type, `waIdToE164` for what Meta sends).
- Use `-` rather than an em dash in anything a user reads.

## §8 Definition of done

1. Types check, lint passes. Note that edge functions are Deno and sit outside
   `tsconfig.app.json`, so `tsc --noEmit` says nothing about them.
2. Reducer tests cover every new event type, including out-of-order arrival.
3. The path is demoable end to end on `MockAdapter` with seeded data.
4. This document is updated if the domain model changed.
5. If it touched renter-facing copy, you have read it:
   `REHEARSAL_PRINT=1 npx vitest run rehearsal` prints the whole conversation.
   `/dev/phone` refuses to run under `WHATSAPP_MODE=cloud`, which is how
   production runs, and a change to a renter message reaches real people on
   merge.

---

## §9 Itinerary, delivery and the silence clock

### Assembly

Only `CONFIRMED` items become stops. A `PRICE_CHANGED` item has no slot by
construction (§4), so it cannot be one however much the renter may still want
it - re-offering it is a new request.

Ops orders the stops by hand and the order is honoured, not re-sorted: route
optimization is out of scope and they know the city. Assembly does flag the two
orderings that are wrong regardless of local knowledge:

- **Overlap** - a stop starting before the previous one ends. Blocks delivery.
- **District hop** - consecutive stops in different districts with under 45
  minutes between. A threshold, not a route estimate; nothing is geocoded.
- **Unknown district** - a `NULL` `district_code` means the check could not
  run, which is reported rather than treated as "fine".

Gaps measured across a night are not journeys and are not warned about.

A confirmed item carrying `actual_price_vnd` is quoted at that price. Never
quote a figure the broker has already changed - which is what
`price_vnd_at_request` exists to make detectable.

### The message

**One message, whatever it carries.** Three in a row to the same renter is a
bug the send service refuses, and from 2026-10-01 each is billed.

It leads with what the renter got ("3 of the 5 places you asked about are
free"), names each day once and then only the times, renders in
Asia/Ho_Chi_Minh, and gives the shortfall one line with no apology. The
renter-facing DTO has no realtor field, so the renderer cannot print a broker's
number even by mistake (§6 by shape, not by discipline).

Nothing says "booked". At delivery the request is `DELIVERED`, not `CONFIRMED`
- the renter has not agreed to anything - and §6 forbids implying otherwise.

`FAILED_NO_SUPPLY` ships with substitutes or, when there are none yet, with a
promise to come back the same day. Never on its own.

**Other times an agent offered are relayed, not dropped.** An
`ALTERNATIVE_OFFERED` item with slots is listed after the plan, in the same
message, under "offered different times", with each day named. It is never a
stop: the renter has not chosen that time. When nothing is confirmed but offers
exist, the message is the offers (`renderAlternativesOnly`), not the no-supply
message - those units are available and their agents are waiting. A renter who
takes one tells us; the operator records `CONFIRMED` with that slot ("Renter took
an offered time" on the card), which makes it a stop, and once the renter says
yes its agent is owed a `CONFIRM` like any other.

### The silence clock

**No open request goes more than 24 hours without the renter hearing
something.** Asserted as a property test over randomly generated event logs
(`reminders.test.ts`), not only as examples.

- The clock starts at intake - the confirmation page already made a promise -
  and moves forward on `ITINERARY_DELIVERED`, `HOLDING_UPDATE_SENT` or
  `REPLY_SENT`.
- The scheduler acts at **20 hours**, not 24. A job firing on the deadline has
  already lost: the send has to happen, be delivered and be read, and the first
  can fail and need a retry.
- A closed request owes the renter nothing, except that a `CONFIRMED` one still
  gets its day-before viewing reminders. Closed for coordination is not closed
  for the renter - or for the brokers, who are owed its decision (§4).
- Brokers are nudged after 6 hours of silence, measured from the last contact
  **or nudge**, which is what feeds the two-nudge floor on `NO_RESPONSE` (§4).

The decision is pure (`_shared/viewing/reminders.ts`); `viewing-jobs-drain`
only runs it on a `pg_cron` schedule and enqueues a `jobs` row per action.
Keeping the two apart is what makes the promise testable without a database and
a clock.

---

## §10 The AI operator

Built in stages, each shipped behind the one before: 0, the console actions it
calls (§4); 1, shadow proposals; 2, renter replies sent alone; 3, the Zalo
bridge and outcomes recorded alone; 4, messages to agents sent alone. Where it
stands in production is at the end of this section.

### Stage 1: shadow

**It proposes; a person decides.** The AI operator writes `operator_proposals`
rows and nothing else - no events, no messages. A proposal reaches the log only
when an operator approves it, and then it runs through `ops-record-outcome`
under the operator's own `OPS:<uuid>`, exactly as if they had pressed the
button themselves. Invariants 1-4 hold because nothing new writes.

**The judgement is rules, the reading is a model.** `planner.ts` is a pure
function from one request's log to the proposals that follow from it: first
message to an uncontacted agent with a number; a chase after six silent hours,
numbered; `NO_RESPONSE` after two chases and more silence; the itinerary once
every agent has answered, ordered by the clock; `CONFIRM`/`RELEASE` to brokers
owed the renter's decision; `CANCEL_REQUEST` on a renter's decline (low
confidence - a keyword "no" can mean less). An agent reply stored after the
item's last outcome is read by paste-parse (`parse-call.ts`, the same call as
the console's button) and proposed as an outcome. Anything the rules cannot
settle - a renter's question, no agent number, a reply that settles nothing,
an itinerary with a clash - is `ESCALATE`, which is a proposal too, and can be
wrong.

| `operator_proposals` | |
|---|---|
| `dedupe_key` | One proposal per situation, ever (`CONTACT:<item>`, `NUDGE:<item>:<n>`, `OUTCOME:<item>:<reply>`, `NOTIFY:<item>:<decision>`, `DELIVER:<request>`, `RENTER:<message>`, `NO_CONTACT:<item>`). Unique per request, so a rejected proposal is not made again. |
| `action`, `input` | An ops action and its input; approving runs exactly this, with the operator's rewording. |
| `status` | `PENDING` → `APPROVED` / `REJECTED` (a button), `AGREED` / `CORRECTED` (the operator did it by hand, the same or differently), or `SUPERSEDED` (the request moved on). From stage 2, also `EXECUTED` (ran alone) and `FLAGGED` (ran alone, marked wrong). |
| `executed_action`, `executed_input`, `edited` | What was actually done, when it differed or was reworded. |
| `execute_after`, `executed_at` | Stage 2: when a qualifying proposal will run alone, and when it did. |

**Scoring** (`proposals.ts`, pure and tested, because stage 2 is gated on it):
approved and agreed count as agreement; corrected and rejected do not; pending
and superseded are not decisions. Rewording a draft or reordering stops on
approval is still agreement (`edited`); changing what the action decides - the
outcome, a slot, the price, the decision - is a correction whichever button was
pressed. Every operator action passes through `performOpsAction`, which scores
any pending proposal it answers, so work done by hand is counted, not lost.

`ai-operator-plan` runs the planner every 10 minutes (`pg_cron`) and on demand
from the console for one request; it reads at most 10 replies per pass and
none once the daily OpenAI cap is reached, escalating instead. The console
shows pending proposals on each request, a count in the queue that never
changes the ranking, and an "AI operator" screen with agreement per action and
paste-parse accuracy against the PLAN-v3 bar (80% of 30+ real replies).

**Drafted renter replies.** For a renter's waiting reply that is not a decline,
the planner proposes `REPLY` with a drafted WhatsApp answer
(`renter-reply.ts`, `reply-call.ts`), keyed on the newest waiting message and
carrying `clientKey: reply-<message id>` so approval is idempotent. The model
is shown listing facts (title, location, district, price, bedrooms, area,
amenities, a phone-masked description), each unit's standing as a sentence
built from its typed outcome, and the request's thread with phone numbers
masked - never a renter's or agent's contact, and no listing contact column is
selected. It is told to answer only from those facts, to say "we will check
with the agent" otherwise (`needs_agent`, which makes the proposal LOW
confidence and tells the operator they still have to ask), and never to agree
a new time. Every draft passes `checkOperatorReply` - no phone numbers, no
"booked" before `CONFIRMED` - or it becomes `ESCALATE` with the reason.
Nothing is drafted when nothing could be sent: an opted-out renter, a closed
24-hour window, or two messages already sent since they last wrote. At most 10
drafts per pass, once per reply, under the daily OpenAI cap.

### Stage 2: acting alone on renter replies

The AI operator may send a renter reply itself - and only that. Broker work
and every escalation stay with people until stage 3. Three locks
(`_shared/viewing/autonomy.ts`), all of which must be open, re-checked on every
pass and again at the moment of running:

1. **`AI_OPERATOR_AUTONOMY`**, an edge-function secret listing the actions
   allowed (`REPLY`). Unset - how it ships - means every lock is shut and the
   planner runs as shadow mode exactly.
2. **`ai_operator_controls.paused`**, which any operator sets from the console
   (`SET_AUTONOMY`). The kill switch needing no dashboard.
3. **The gate**, measured from people's own stage 1 decisions on that action:
   at least 30 of the most recent 100 decided, at least 90% agreed, at most 20%
   reworded on the way out. Once acting, more than 5% of its own actions
   flagged (over 10+) closes it again. The shadow record is the most recent
   decisions however old, not a date window, because people decide fewer once
   an action runs itself.

Only a `REPLY` at HIGH confidence qualifies - a draft answered wholly from the
facts. A holding reply ("we will check with the agent") is LOW and always goes
to a person, since it promises work only a person can start.

A qualifying proposal made while its lock is open gets `execute_after = now +
5 minutes`. The console shows it with the time it will send and a **Hold**
button (`HOLD_PROPOSAL`, clears `execute_after`); approving, rejecting or doing
the work by hand also stop it. On a later pass, if it is still wanted and every
lock is still open, it runs through `performOpsAction` as `AGENT:auto-v1` - the
24-hour window, the 3-in-a-row guard and persist-before-send all apply - and
becomes `EXECUTED`. A refused run is handed to a person (`execute_after`
cleared, the reason in `decision_note`), never retried.

A sent message cannot be unsent. **Flag as wrong** (`FLAG_PROPOSAL`) on the AI
operator screen marks an `EXECUTED` proposal `FLAGGED` with a note: it tells a
person to follow up with the renter, and feeds the flag rate that can close the
gate. `EXECUTED` and `FLAGGED` are not shadow decisions and never count towards
agreement - otherwise the AI operator could raise its own rate. The planner
writes what it concluded about each lock to `ai_operator_controls.last_state`
for the console, which cannot read the secret.

**The gate override.** `ai_operator_controls.gate_override` lists actions whose
measured gate an owner has chosen to skip. It skips the shadow record only: the
env switch and the pause still apply, and so does the flag ceiling, so an
override that goes wrong still closes itself. The console shows "gate skipped"
beside the action with a **Restore the gate** button (`SET_AUTONOMY` with
`gateOverride`). First used for `REPLY` on 2026-09-27, by the owner's decision,
with no shadow decisions yet recorded; see "Where it stands" below for what it
covers now.

### Stage 3: the Zalo bridge, and outcomes recorded alone

**The bridge** (`bridge/`, owner's decision 2026-09-27) is a daemon on an
always-on device logged in to the business's Zalo account through zca-js, an
unofficial client - an accepted risk to the account. With the
`REALTOR_CHANNEL` secret set to `bridge`, `BridgeChannel` leaves a message to an
agent `QUEUED` instead of treating it as sent by hand, and the event it stands
for (`REALTOR_CONTACTED`, `ITEM_NUDGED`, `REALTOR_NOTIFIED`) waits on the row in
`realtor_messages.on_sent_event`. The device talks to `zalo-bridge`
(`_shared/realtor/bridge.ts`), authenticated by `ZALO_BRIDGE_TOKEN`:

- **pull** - a heartbeat, then up to 10 `QUEUED` messages claimed for a 10-minute
  lease (`claimed_at`), with the agent's number, and the **watch list**: agent
  numbers on requests from the last 21 days. Nothing while
  `zalo_bridge_status.paused`.
- **ack** - `SENT` writes the deferred event, once; a repeat ack writes nothing.
  `FAILED` records why, and sending again from the console requeues the same
  row with the new wording (`requeue`).
- **inbound** - a message from a number in `realtors` is stored as an `IN`
  reply (actor `BRIDGE`, key `bridge:<zalo msg id>`) against the item that agent
  was last sent something about, and the planner is asked to read it at once.
  Anyone else is dropped, unstored.

The device only forwards senders on the watch list, journals every send before
acking so a crash cannot resend, and holds a daily cap and a minimum gap
between sends to bound the damage of a mistake - nothing in it disguises the
automation. The console shows the device (online, sent today, queued, last
error), a **Pause sending** switch (`SET_BRIDGE`), queued and failed messages
on each item, and send buttons that say whether a person or the device sends.

**Outcomes recorded alone.** `OUTCOME` joins `REPLY` in `AUTONOMOUS_ACTIONS`,
behind the same three locks with its own gate and record. Only an outcome read
from an agent's reply by paste-parse qualifies (key `OUTCOME:<item>:<reply>`,
HIGH confidence, nothing flagged); `NO_RESPONSE` never does. It waits the same
5-minute hold and runs as `AGENT:auto-v1`. The `REPLY` gate override does not
open it.

### Stage 4: messages to agents sent alone

`CONTACTED`, `NUDGE` and `NOTIFY_REALTOR` join `AUTONOMOUS_ACTIONS`: the first
ask, a chase, and the confirm or release once the renter has decided. The plan
gates this stage on "OA/ZNS, or an explicit accepted-risk decision"; the owner
made that decision for the bridge on 2026-09-27.

They open **only while `REALTOR_CHANNEL` is `bridge`** (`REALTOR_SENDS` in
`autonomy.ts`). Under the manual channel, recording "contacted" means a person
already sent it by hand, so an AI operator recording it would be claiming a
message nobody sent. Each has its own gate on its own stage 1 record; the
`REPLY` override opens none of them. Run alone, the message is queued for the
device like any approved one and the event waits for the device's ack, carrying
`AGENT:auto-v1` - so the log says the AI operator contacted the agent only once
the bridge has sent it. The daily cap, the device pause and the 5-minute hold
all apply. `NO_RESPONSE`, the itinerary and cancelling stay with people.

**The planner does not message agents about windows that have passed.** Once
every availability window on a request is over (`windowsAllPassed` in
`planner.ts`, #116), it proposes no first ask and no chase; agents' replies are
still read. While any item is still `PENDING` or `CONTACTED` it proposes one
`ESCALATE` (`STALE_WINDOWS:<request>`) instead: the renter needs asking for new
times, and that is a person's job.

### Where it stands (read from production, 2026-09-28)

- All five `AUTONOMOUS_ACTIONS` - `REPLY`, `OUTCOME`, `CONTACTED`, `NUDGE`,
  `NOTIFY_REALTOR` - are enabled by `AI_OPERATOR_AUTONOMY`, and all five are in
  `gate_override`. The console is not paused, so every lock reads open with the
  reason "Gate skipped by override - 0 shadow decisions so far".
- `REALTOR_CHANNEL` is `bridge`, and the bridge device checks in
  (`zalo_bridge_status.last_seen_at` current, not paused).
- There is no stage 1 record yet to measure against: no `OUTCOME_RECORDED`
  events and no `realtor_messages` rows. The flag ceiling (5% of 10+ executed)
  is therefore the only measured lock that can close, and only once there is
  traffic.

Restoring any gate is one button on the AI operator screen, and **Pause** on
the same screen stops everything the AI operator does alone.

## §11 Availability requests and complex watches

"Check availability at Empire City." A complex page's one call to action is
a request to the concierge: a person on our team asks the agents who hold
units in the building and replies within 24 hours. The crawl only knows what
was advertised, and for most buildings that is nothing in a given month -
which is why a person, not an automated alert, is what the page offers.

WhatsApp only. Email was the original channel and is retired for new
requests: one channel keeps one thread, and the 24-hour window keeps the
concierge quick. The email requests made before keep their threads, and are
still answered by email (`channel = 'EMAIL'`). Any country's WhatsApp number
works (§1, §6).

A request is not a viewing request. It spends no credit and is not in the
event log: it asks a person to look, and viewings of what they find are
requested the one way there is (invariant 8), from the listing page.

### The form (`ConciergeCaptureModal`)

1. **What you need** - move-in date, lease (6, 12 or 24+ months), bedrooms
   (1-4+), the most they would pay a month in million ₫ (with a rough US$
   figure beside it, never stored), pets, optional notes, and their name.
2. **Send it on WhatsApp.** `complex-inquiry-create` returns a wa.me link:
   `Hi Hausto - please check availability at <complex> for me (HW-XXXX)`. The
   form asks for no phone number: the message proves the number is theirs,
   opts them in, and opens the 24-hour window the concierge's promise is
   measured against.

`complex-inquiry-create` (anonymous or signed in, rate-limited by IP)
validates (`validateInquiryInput`), writes the request and a `PENDING` complex
watch with the same criteria, whose code is the handshake. Browsers can no
longer insert `complex_inquiries` directly.

### `complex_inquiries` (additive columns)

```
channel                text not null   -- WHATSAPP; EMAIL on requests made before
budget_max_vnd         bigint          -- the form's ceiling
watch_id               uuid references complex_watches -- the handshake
renter_id              uuid references renters        -- set when the code arrives
whatsapp_confirmed_at  timestamptz     -- the concierge's clock starts
```

`channel` has no default: a new request says what it is. `email` and the old
`budget_usd_*` are nullable now; an EMAIL request must have an email.
`INQUIRY_CHANNELS` in `viewing-domain.ts`.

### The thread (`complex_inquiry_messages`)

One conversation per request whatever carried each message, so Admin Tools
shows it whole. Additive: `channel` (`WHATSAPP` | `EMAIL`),
`whatsapp_message_id` (the `messages` row, unique), `from_email` nullable, and
`source` may be `whatsapp` (composed on the renter's phone).

### On WhatsApp

1. **The code arrives.** `handleInbound` confirms the watch (below) and, when
   it belongs to a request, the request: `renter_id`, `phone`,
   `whatsapp_confirmed_at`. The code message opens the thread. One reply
   (`renderInquiryConfirmed`) says back what we heard, that a person replies
   here within 24 hours, and that new listings there will be alerted until
   the watch ends. Then the webhook asks `notify-complex-inquiry` to mail the
   concierge - at confirmation, not at the form, because until the code
   arrives there is nobody to reply to.
2. **The concierge replies.** From Admin Tools (`concierge-email-reply`,
   which sends by the request's channel) or by hitting Reply in Gmail
   (`concierge-email-inbound` relays it to WhatsApp). Free-form only, inside
   the window. When it has closed nothing can reach the renter until they
   write again: the dashboard says so and disables the reply, and a Gmail
   reply comes back to the admin as "did not go out" with the reason. An
   approved utility template for "we have an update" is what would close that
   gap; none exists yet. The consecutive-outbound rule (§5) holds: two
   messages without an answer and the next is refused - so the confirmation
   plus one concierge message, until the renter writes back.
3. **The renter answers.** When the last thing we sent them is on a
   request's thread (`inquiryAwaitingReply`), their message is filed there,
   never attached to a viewing request (so a "yes" cannot confirm an
   itinerary), answered by nothing automated, and mailed to the concierge as
   "💬 replied on WhatsApp".

Admin Tools lists a WhatsApp request only once its code has arrived, with the
hours left in the window.

### Worked in the ops console (PLAN-v3 S7.1a)

WhatsApp requests are worked on the ops console's Availability screen; Admin
Tools keeps the old email requests only. The console reads through
`ops_inquiries()` and `ops_inquiry_detail()` (ops or admin), which never return
the renter's name, phone, email or account (invariant 4) and mask numbers in
the thread and notes with `mask_phone_numbers()`.

**State is derived** from `inquiry_events`, append-only like `events` (UPDATE,
DELETE and TRUNCATE revoked, service role included), by `reduceInquiry()` in
`viewing-domain.ts`:

```
id           bigint identity
inquiry_id   uuid references complex_inquiries
type         SUBMITTED | CONFIRMED | AGENT_ASKED | AGENT_ANSWERED | CLOSED | REOPENED
payload      jsonb      -- realtor_id, medium, answer, reason, note
actor        text       -- RENTER, USER:<uuid>, OPS:<uuid>, AGENT:<version>
occurred_at  timestamptz
```

`AWAITING_CODE` (form sent, no WhatsApp message) → `NEW` (code arrived; the 24
hours start) → `SOURCING` (an agent asked) → `CLOSED` (one of
`INQUIRY_CLOSE_REASONS`), reopenable. An agent's first ask stands; their latest
answer (`HAS_UNITS | NO_UNITS | NO_REPLY`) stands. SUBMITTED is written by
`complex-inquiry-create`, CONFIRMED when the code arrives; the rest are
operator steps through `performOpsAction` (invariant 10): `INQUIRY_ASK_AGENT`,
`INQUIRY_AGENT_ANSWERED`, `INQUIRY_CLOSE`, `INQUIRY_REOPEN`, and
`INQUIRY_REPLY`, which sends on WhatsApp through `sendConciergeWhatsApp` after
`checkOperatorReply` (no phone numbers, no booking). Nothing works a request
before its code arrives. Messages stay in the thread, not the log: what was said
is not a state.

The brief: the criteria, the deadline (code + 24h), the window and
consecutive-outbound count, the thread, the building's roster, and the listings
on file that fit - requestable, within budget and bedrooms - with their agents,
marked as advertised rather than available.

### Building agents (PLAN-v3 S7.0)

Who can be asked about a building. Two kinds, merged by
`ops_building_roster()` (ops or admin only) and shown on the ops console's
Buildings screen, buildings with requests first:

- **Found from listings** (`LISTING`): anyone whose listings match the building
  by name or alias, the `complex_listing_ids()` rule over all time. Not stored.
  An agency's site (one number across 30+ listings citywide - Housing SGN has 73)
  is flagged as a desk, not someone who holds units there.
- **Added by an operator** (`MANUAL`, `MANAGEMENT`), stored in `complex_agents`:

```
complex_id  uuid references complexes    -- pk with realtor_id
realtor_id  uuid references realtors
source      text                         -- MANUAL | MANAGEMENT
note        text                         -- which tower, how we met; never parsed
added_by    text                         -- OPS:<uuid>
created_at  timestamptz
```

Written by `ADD_BUILDING_AGENT` / `REMOVE_BUILDING_AGENT` through
`performOpsAction` (invariant 10); the number goes through `toE164`, since
agents are Vietnamese and the bridge dials it. A roster entry is a contact, not
a request's state, so it writes no event and can be removed. Each agent carries
how many listings they have there and citywide, when they last listed, and when
they last replied to us - who to ask first. `BUILDING_AGENT_SOURCES` in
`viewing-domain.ts`; the target is `ROSTER_TARGET` (3) per building.

### Complex watches

The alert half. Created by a WhatsApp request; there is no separate entry
point.

```
complex_watches
id              uuid pk
complex_id      uuid not null references complexes
code            text unique not null      -- HW-XXXX, the ref alphabet
user_id         uuid                      -- the account that set it up, if any
renter_id       uuid references renters   -- set when the code arrives
bedrooms        smallint                  -- 1-4, 4 means 4+; NULL any
budget_max_vnd  bigint                    -- monthly ceiling; NULL any
move_in_by      date
status          text not null             -- PENDING | ACTIVE | CANCELLED
confirmed_at    timestamptz
expires_at      timestamptz not null
created_at, updated_at

alert_items
id              uuid pk
renter_id       uuid not null references renters
listing_id      uuid not null references external_properties
watch_id        uuid references complex_watches  -- NULL for a digest pick
source          text not null             -- WATCH | DIGEST
message_id      uuid not null references messages
detail_sent_at  timestamptz               -- the places themselves went out
created_at      timestamptz
unique (renter_id, listing_id)
```

`WATCH_STATUSES`, `ALERT_SOURCES` in `viewing-domain.ts`. Service role
writes; admins read `complex_watches`.

- **Confirm.** The code works for `CONFIRM_TTL_DAYS` (7), only from the phone
  that first sent it, and clears an earlier `opted_out_at` - sending it is the
  renter opting back in. It links `renters.user_id` if that is empty.
- **Sweep.** `viewing-digest-send`, Tuesday 09:00 ICT. For each active watch,
  new listings at the complex (`complex_listing_ids`: name or alias in the
  title or location, the complex page's rule) created after `confirmed_at`
  that pass the intake gate (`screenCandidates`) and fit the bedrooms and
  budget. Merged with the renter's digest picks, watches first, three at most,
  nothing already in `alert_items`. One message per renter per ISO week
  (`DIGEST:<week>`): the `weekly_digest` template with the complex name as
  `{{3}}`, or free-form with the places in it if their window is open.
- **Reply.** When the last thing we sent is an alert whose places have not
  gone out, anything but a no or STOP gets them free-form, with a link each
  (`ALERT_DETAILS`) - "show me" included, which the intent classifier reads
  as a search.
- **End.** STOP cancels every active watch. Otherwise `MOVE_IN_GRACE_DAYS`
  (14) after the move-in date, never later than `MAX_WATCH_DAYS` (120).

The confirmation, the alert places and the concierge's thread are sent with
`VIEWING_AGENT_ENABLED` off: none is the agent's judgement. Replies on a
request's thread are answered by a person, agent on or off.

Limits: Meta bills by the recipient's country, so a template to a UK or US
number costs more than one to a Vietnamese number. Meta's sender id can differ
from how a Mexican or Brazilian renter types their number (an extra digit), so
for them a typed number and their messages can land on two renter rows - the
request flow never asks for a typed number, so it is unaffected. And the
approved `weekly_digest` wording reads "there are 1 new places" for a single
match; a dedicated template is the fix.
