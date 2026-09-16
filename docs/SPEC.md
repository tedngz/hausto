# SPEC - viewing coordination domain model

Status: draft, authoritative. Written 2026-09-10 alongside `docs/PLAN-v3.md`.

A renter shortlists 1-5 crawled rentals and requests viewings. A human
operator working Zalo confirms availability with each realtor. The system
assembles an itinerary and delivers it over WhatsApp. The renter confirms with
one tap.

The renter never talks to a realtor. The realtor never sees the renter's contact
details. Everything crosses through us.

Nothing in this document exists yet. Everything in §0 is additive to the live
schema; §1 onward is new.

---

## §0 Additive columns on existing tables

The live listing table is `public.external_properties` (696 rows, 115 active).
Do not restructure it. Add only:

| Column | Type | Why |
|---|---|---|
| `price_vnd` | `integer` | Canonical. `price` is `numeric` and holds USD for housingsgn rows (a live row reads `price = 730`, `price_display = '$730 / month'`). Convert on write; never read `price` for money decisions. |
| `price_confidence` | `text` | `HIGH` / `LOW`. `LOW` when the extracted price disagrees with a price mentioned in title or description by >15%. `LOW` rows stay searchable but cannot be shortlisted. |
| `bedrooms` | `smallint` | `rooms` is free text: `'2 Bedrooms'`, `'Studio'`, `'4+ Bedrooms'`. Zero of 115 active rows parse as a bare integer. `Studio` maps to `0`. |
| `bedrooms_is_min` | `boolean` | True for `'4+ Bedrooms'`, so a `= 4` filter does not silently claim precision. |
| `area_sqm` | `numeric` | `size` is free text; 17 of 115 active rows are numeric. |
| `district_code` | `text` | Parsed from raw `location` by `public.vn_district_code(city, location)`, which is the authority - the codes are not enumerated here because they drift. Scoped by `city`: district names collide across cities, so this is unique on `(city, district_code)`, never on `district_code` alone. **Not** parsed from `location_normalized`, which deletes accented characters rather than folding them (`Bình Thạnh` → `bnh thnh`) and cannot be matched against. |
| `source_agent_id` | `text` | The broker's profile id on the source site. The durable join key for realtor identity - see §1. Free on nhatot (`account_oid`), and the half of identity that does not have to be bought: the phone usually needs a reveal, this arrives with the ad. |
| `realtor_id` | `uuid` | Resolved broker, nullable. Set at ingest in the order agent identity → phone → NULL. A NULL here is normal and not a defect: a listing needs a contact only once a renter shortlists it. |
| `delisted_at` | `timestamptz` | Distinct from `deactivated_at`. Set when a re-verification **confirms** the unit is gone - the listing's own source saying so, twice - or when it goes 21 days without a price confirmation. A URL that merely failed to resolve sets `deactivated_at` only; on nhatot that is routinely wrong, since expired ads come back under the same id when the seller reposts. |
| `price_confirmed_at` | `timestamptz` | When the listing's price was last read back from the source and still matched. Only set by sources whose price can be re-read (today: nhatot, whose ad payload carries it), and left NULL elsewhere rather than filled with a check that was never run. `last_verified_at` only ever meant "the URL resolves", which is not the question ops needs answered. |

`price_vnd`, `bedrooms`, `area_sqm` and `district_code` are NOT NULL for any row
eligible for shortlisting. Enforce with a partial index, not application code.

**`price` carries two currencies and only its magnitude says which.** housingsgn
quotes USD, and the display is not a reliable tell - a live row reads
`price = 12500000, price_display = '$500/month'`, already converted with the
display never updated. Converting on a `# SPEC - viewing coordination domain model

Status: draft, authoritative. Written 2026-09-10 alongside `docs/PLAN-v3.md`.

A renter shortlists 1-5 crawled rentals and requests viewings. A human
operator working Zalo confirms availability with each realtor. The system
assembles an itinerary and delivers it over WhatsApp. The renter confirms with
one tap.

The renter never talks to a realtor. The realtor never sees the renter's contact
details. Everything crosses through us.

Nothing in this document exists yet. Everything in §0 is additive to the live
schema; §1 onward is new.

---

## §0 Additive columns on existing tables

The live listing table is `public.external_properties` (696 rows, 115 active).
Do not restructure it. Add only:

| Column | Type | Why |
|---|---|---|
| `price_vnd` | `integer` | Canonical. `price` is `numeric` and holds USD for housingsgn rows (a live row reads `price = 730`, `price_display = '$730 / month'`). Convert on write; never read `price` for money decisions. |
| `price_confidence` | `text` | `HIGH` / `LOW`. `LOW` when the extracted price disagrees with a price mentioned in title or description by >15%. `LOW` rows stay searchable but cannot be shortlisted. |
| `bedrooms` | `smallint` | `rooms` is free text: `'2 Bedrooms'`, `'Studio'`, `'4+ Bedrooms'`. Zero of 115 active rows parse as a bare integer. `Studio` maps to `0`. |
| `bedrooms_is_min` | `boolean` | True for `'4+ Bedrooms'`, so a `= 4` filter does not silently claim precision. |
| `area_sqm` | `numeric` | `size` is free text; 17 of 115 active rows are numeric. |
| `district_code` | `text` | Parsed from raw `location` by `public.vn_district_code(city, location)`, which is the authority - the codes are not enumerated here because they drift. Scoped by `city`: district names collide across cities, so this is unique on `(city, district_code)`, never on `district_code` alone. **Not** parsed from `location_normalized`, which deletes accented characters rather than folding them (`Bình Thạnh` → `bnh thnh`) and cannot be matched against. |
| `source_agent_id` | `text` | The broker's profile id on the source site. The durable join key for realtor identity - see §1. Free on nhatot (`account_oid`), and the half of identity that does not have to be bought: the phone usually needs a reveal, this arrives with the ad. |
| `realtor_id` | `uuid` | Resolved broker, nullable. Set at ingest in the order agent identity → phone → NULL. A NULL here is normal and not a defect: a listing needs a contact only once a renter shortlists it. |
| `delisted_at` | `timestamptz` | Distinct from `deactivated_at`. Set when a re-verification **confirms** the unit is gone - the listing's own source saying so, twice - or when it goes 21 days without a price confirmation. A URL that merely failed to resolve sets `deactivated_at` only; on nhatot that is routinely wrong, since expired ads come back under the same id when the seller reposts. |
| `price_confirmed_at` | `timestamptz` | When the listing's price was last read back from the source and still matched. Only set by sources whose price can be re-read (today: nhatot, whose ad payload carries it), and left NULL elsewhere rather than filled with a check that was never run. `last_verified_at` only ever meant "the URL resolves", which is not the question ops needs answered. |

`price_vnd`, `bedrooms`, `area_sqm` and `district_code` are NOT NULL for any row
eligible for shortlisting. Enforce with a partial index, not application code.

 in the display turns that into 312
billion dong. The threshold sits in the gap between the currencies, not at the
edge of one: below 100,000 is USD, at or above it is dong. A rent of
`2800000` ('2,8 triệu/tháng') is real and cheap, and any threshold near 3
million misreads it.

**Coverage is partial and that is expected.** On the 145 active rows: bedrooms
144, price 145, district 129, area 124 - **107 shortlistable on all four**. The
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

Also drop from the `public-property-search` response: `vibe`. It is non-null on
28 of 115 active rows and carries no signal `style_tags` does not. **The style
filter at `public-property-search/index.ts:116` and `:191` reads `vibe` via
`ilike` - re-point both at `vibe_analysis->styles` before removing the field.**
All 115 active rows have a populated `styles` array, so the filter survives the
move. Keep `style_tags`, `image_highlights`, `amenities`.

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
phone_e164                text unique not null
display_name              text
service_window_expires_at timestamptz    -- see §5
opted_out_at              timestamptz
created_at                timestamptz default now()
```

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

One per shortlisted unit. 1-5 per request. Status is **derived**.

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
  at most 14 days ahead.
- A shortlisted listing must clear the §0 gate - active, `price_vnd`,
  `bedrooms`, `area_sqm` and `district_code` all present, `price_confidence`
  not `LOW`. Screening happens at submit rather than at shortlist time, because
  verification runs every 20 minutes and can deactivate a row in between. A
  listing that falls through is reported to the renter by name; the request
  proceeds on the rest as long as three survive.

### `events`

Append-only. The single source of truth for all state. See §3.

```
id           bigserial pk
request_id   uuid not null
item_id      uuid                         -- null for request-level events
type         text not null                -- SCREAMING_SNAKE, see §3
payload      jsonb not null default '{}'
actor        text not null                -- OPS:<uuid> | RENTER | SYSTEM
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
```

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
| `ITEM_ADDED` | item | `{listing_id, price_vnd_at_request}` |
| `REALTOR_RESOLVED` | item | `{realtor_id, method}` - `method` ∈ `AGENT_ID`, `PHONE`, `MANUAL` |
| `REALTOR_CONTACTED` | item | `{channel, draft_id}` |
| `OUTCOME_RECORDED` | item | `{outcome, slots[], actual_price_vnd, note}` - see §4 |
| `ITEM_NUDGED` | item | `{attempt}` |
| `ITINERARY_ASSEMBLED` | request | `{ordered_item_ids[], warnings[]}` |
| `ITINERARY_DELIVERED` | request | `{message_id}` |
| `HOLDING_UPDATE_SENT` | request | `{message_id}` - something the renter heard that was not the itinerary |
| `RENTER_REPLIED` | request | `{intent, message_id}` - `intent` ∈ `CONFIRM`, `DECLINE`, `RESCHEDULE`, `QUESTION`, `OPT_OUT`, `UNKNOWN` |
| `REQUEST_CONFIRMED` | request | `{confirmed_item_ids[]}` |
| `REQUEST_CANCELLED` | request | `{reason, actor}` |
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

Enum values are SCREAMING_SNAKE in the DB, mirrored as TS union types generated
from a single source in `lib/domain/enums.ts`.

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
  from the approved registry in `lib/whatsapp/templates.ts`.
- From 2026-10-01 Meta bills service and utility messages sent inside the window.
  Consolidate: one message carrying a full itinerary, not a sequence of turns.
  **Any code path that sends 3+ messages in a row to the same renter is a bug.**

Adapter: `lib/whatsapp/adapter.ts` exports a `WhatsAppAdapter` interface with two
implementations - `MockAdapter` (the default in dev and in all tests, rendering
in `/dev/phone`) and `CloudApiAdapter` (`WHATSAPP_MODE=cloud`).

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

**No `booking` vocabulary in renter-facing copy until state is `CONFIRMED`.** Use
"request". We cannot honour a booking at intake time.

---

## §7 Conventions

- Money in VND, stored as integer dong. Never floats. Display `15.000.000 ₫`.
- All timestamps stored UTC, displayed `Asia/Ho_Chi_Minh`.
- Phone numbers stored E.164 (`+84...`). Normalize at every boundary - the
  crawler hands you `0901234567`, `84901234567` and `+84 90 123 45 67` for the
  same human.
- Use `-` rather than an em dash in anything a user reads.

## §8 Definition of done

1. Types check, lint passes. Note that edge functions are Deno and sit outside
   `tsconfig.app.json`, so `tsc --noEmit` says nothing about them.
2. Reducer tests cover every new event type, including out-of-order arrival.
3. The path is demoable end to end on `MockAdapter` with seeded data.
4. This document is updated if the domain model changed.

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

### The silence clock

**No open request goes more than 24 hours without the renter hearing
something.** Asserted as a property test over randomly generated event logs
(`reminders.test.ts`), not only as examples.

- The clock starts at intake - the confirmation page already made a promise -
  and moves forward on `ITINERARY_DELIVERED` or `HOLDING_UPDATE_SENT`.
- The scheduler acts at **20 hours**, not 24. A job firing on the deadline has
  already lost: the send has to happen, be delivered and be read, and the first
  can fail and need a retry.
- A closed request is owed nothing, except that a `CONFIRMED` one still gets
  its day-before viewing reminders. Closed for coordination is not closed for
  the renter.
- Brokers are nudged after 6 hours of silence, measured from the last contact
  **or nudge**, which is what feeds the two-nudge floor on `NO_RESPONSE` (§4).

The decision is pure (`_shared/viewing/reminders.ts`); `viewing-jobs-drain`
only runs it on a `pg_cron` schedule and enqueues a `jobs` row per action.
Keeping the two apart is what makes the promise testable without a database and
a clock.
