# SPEC - viewing coordination domain model

Status: draft, authoritative. Written 2026-09-10 alongside `docs/PLAN-v3.md`.

A renter shortlists 3-5 crawled HCMC rentals and requests viewings. A human
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
| `district_code` | `text` | `location_normalized` is diacritic-stripped prose (`'ng bn vn n phng 1 qun 4 h ch minh'`), not a code. Use `D1`..`D12`, `BINH_THANH`, `THU_DUC`, `PHU_NHUAN`, `TAN_BINH`, `GO_VAP`, `BINH_TAN`, `NHA_BE`. |
| `source_agent_id` | `text` | The broker's profile id on the source site. The durable join key for realtor identity - see §1. |
| `delisted_at` | `timestamptz` | Distinct from `deactivated_at`. Set when a re-verification confirms the unit is gone or the price moved, not when a URL fails to resolve. |

`price_vnd`, `bedrooms`, `area_sqm` and `district_code` are NOT NULL for any row
eligible for shortlisting. Enforce with a partial index, not application code.

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

One per shortlisted unit. 3-5 per request. Status is **derived**.

```
id                   uuid pk
request_id           uuid references viewing_requests(id)
listing_id           uuid references external_properties(id)
realtor_id           uuid references realtors(id)   -- nullable until resolved
price_vnd_at_request integer not null               -- what the renter was shown
sort_order           smallint                       -- ops-ordered itinerary position
```

`price_vnd_at_request` is what makes "the broker quoted a different price" a
detectable event rather than an argument.

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
| `RENTER_REPLIED` | request | `{intent, message_id}` |
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
