# Taking WhatsApp live

## Status, checked 2026-09-27

**Live.** Read from production rather than remembered:

- Every secret in the table below is set and non-empty, and `WHATSAPP_MODE` is
  `cloud` (its digest matches `sha256("cloud")`), since 2026-09-18.
  `WHATSAPP_BUSINESS_PHONE` is not the `+84000000000` placeholder.
- All five registry templates are `APPROVED` in `whatsapp_template_status`
  (plus Meta's sample `hello_world`), synced hourly.
- Real traffic has flowed: outbound rows carry `wamid.` provider ids, and
  inbound messages are arriving through the webhook.
- `VIEWING_AGENT_ENABLED` is **not set**, so the agent is off and every reply
  routes to an operator. That is the intended starting point, not a gap.

Consequences worth knowing: `/dev/phone` now refuses to run, so renter-facing
copy is read with `REHEARSAL_PRINT=1 npx vitest run rehearsal` (CLAUDE.md, DoD
5), and any change to a renter message reaches real people on merge.

The rest of this document is how it got here, kept for the next number or the
next environment.

---

Everything in the code is done. `MockAdapter` and `CloudApiAdapter` implement the
same interface, `WHATSAPP_MODE=cloud` picks the second one, and the sending
rules (persist-then-send, idempotency, the 24-hour window, the 3-in-a-row guard)
are transport-independent - see SPEC §5.

What remains is almost entirely on Meta's side, and none of it can be done from
this repo. This is the order to do it in, what each step gates, and how to know
it worked.

Do not flip `WHATSAPP_MODE` first. Read "The cutover" below before you do
anything - the switch is the last step, not the first.

---

## 1. The secrets

Set these at
`https://supabase.com/dashboard/project/gbgrwjdmytaksrztcyzs/settings/functions`.

**Set them in the dashboard, not from a shell.** CLAUDE.md records three separate
incidents of a pasted value arriving mangled or a `$var` expanding to nothing,
and an empty secret is a *valid* secret: the CLI stores it, reports success, and
the failure surfaces much later as a generic error from whatever consumes it.

| Secret | Read by | What breaks without it |
|---|---|---|
| `WHATSAPP_MODE` | `adapterFromEnv`, `dev-phone` | Nothing - defaults to `mock`. Set to `cloud` last. |
| `WHATSAPP_PHONE_NUMBER_ID` | `adapterFromEnv` | In cloud mode, `adapterFromEnv` **throws**. Deliberate: falling back to mock would fill `messages` with SENT rows nobody received. |
| `WHATSAPP_ACCESS_TOKEN` | `adapterFromEnv` | Same. |
| `WHATSAPP_APP_SECRET` | `whatsapp-webhook` | Every inbound is rejected 403. The webhook cannot tell an unsigned caller from Meta. |
| `WHATSAPP_VERIFY_TOKEN` | `whatsapp-webhook` | Meta's subscription handshake fails; you never get inbound at all. |
| `WHATSAPP_BUSINESS_PHONE` | `viewing-request-create` | **Silent breakage - see the trap below.** |
| `WHATSAPP_WABA_ID` | `whatsapp-template-sync` | The hourly reconciliation no-ops. Nothing breaks, but a withdrawn approval stops being noticed. |
| `VIEWING_AGENT_ENABLED` | `whatsapp-webhook`, `dev-phone` | The agent stays silent. Everything routes to an operator, which is the safe default and where this should start. |

### The agent switch

`VIEWING_AGENT_ENABLED` is the one flag that turns automated replies on. It is
off unless the value is exactly `true` - a typo, an empty string, or the
variable not existing all mean off, which is the direction a flag controlling
outbound messages should fail in.

With it on, exactly two things happen automatically, and only in reply to a
message the renter sent:

| Renter says | Agent does |
|---|---|
| "2" / "1 and 3" / "the second one", against a list we sent | Creates a **new** request for those listings and confirms it |
| A pick it cannot honour (list expired, number not on it) | Says why, in one message |
| "anything in district 2 under 15tr" | Searches and replies with three listings |
| Anything else | **Nothing.** An operator handles it |

That last row is most of the traffic, and deliberately. `QUESTION` is the
tempting thing to automate and the wrong one: "what floor is it on" is a
question, and answering it with three unrelated flats is worse than not
answering. The search intent is narrow on purpose - it needs the renter to
describe a want, not merely to ask something.

**One reply per inbound message, always.** `decideAction` returns a single
action or none; it cannot return a list. The 3-in-a-row guard in `send.ts` is
the backstop, not the mechanism.

An opt-out outranks everything, including a selection in the same message -
replying at all is the wrong answer to "stop messaging me".

`/dev/phone` reads the same flag and takes the same path, so the mock is a
rehearsal rather than an approximation. The one thing it will not do is
dispatch a search, because that spends model budget and a mock phone should
not quietly do that; it reports the decision instead.

### The trap: `WHATSAPP_BUSINESS_PHONE`

It defaults to `+84000000000`. That is a real-looking number that produces a
working-looking `wa.me` link which goes nowhere.

This matters more than it looks. The renter tapping that link is the **only**
thing that opens their 24-hour service window. If the number is wrong, intake
succeeds, the confirmation page renders, the link looks fine - and every
subsequent send fails with `service_window_closed`, which reads like a
window-timing bug rather than a wrong phone number.

Set this to the provisioned number in E.164 (`+84...`) the moment you have it.

`supabase secrets list` returns SHA-256 digests, never values. That is enough to
prove a secret is *not* empty, which is the useful check:

```sh
# sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
npx supabase secrets list --project-ref gbgrwjdmytaksrztcyzs
```

It cannot prove a secret is *correct* - a one-character value hashes to
something that looks perfectly healthy.

---

## 2. The Meta-side sequence

Each step gates the next. Doing them out of order mostly means waiting twice.

1. **Meta Business account + Business verification.** Business verification is
   the long pole: it needs documents proving the legal entity and can take days
   to weeks, and rejections are common on mismatched names or addresses. Start
   it before anything else, because steps 4 and 5 are gated on it.
2. **A WhatsApp Business Account (WABA)** under that business, and an app with
   the WhatsApp product added. The app gives you `WHATSAPP_APP_SECRET`.
3. **Provision a phone number.** It must not be attached to a personal WhatsApp
   or WhatsApp Business app account - if it is, delete that account first and
   expect a cooling-off period. This gives you `WHATSAPP_PHONE_NUMBER_ID` (the
   API id, *not* the phone number) and `WHATSAPP_BUSINESS_PHONE` (the number
   itself, for the deep link).
4. **A permanent access token.** Generate it from a System User with the WABA
   assigned, not the temporary 24-hour token from the app dashboard - a test
   token expiring overnight is a confusing outage the next morning.
5. **Submit the five templates** (see below). Approval is typically hours but
   can be days, and a rejection means editing and resubmitting.
6. **Point the webhook at the function and subscribe** (see below).

Steps 1-5 are yours. I cannot do any of them.

---

## 3. The webhook

URL:

```
https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/whatsapp-webhook
```

`supabase/config.toml` already sets `verify_jwt = false` for it - Meta cannot
present a Supabase JWT, so the `X-Hub-Signature-256` HMAC over the raw body is
what authenticates the caller instead. Without that config entry the request
would be rejected before reaching the code.

In the app's WhatsApp → Configuration panel, set the callback URL and the verify
token (matching `WHATSAPP_VERIFY_TOKEN`), then **subscribe to the `messages`
field**. Subscribing to the webhook without that field gives you a green
handshake and no inbound messages.

The handshake is a `GET` with `hub.mode=subscribe`, `hub.verify_token` and
`hub.challenge`; the function echoes the challenge back as plain text. If it
fails, the token does not match - nothing else in that path can fail.

---

## 4. The templates

Submit these **with these exact names and this exact parameter order**. The
registry in `_shared/whatsapp/templates.ts` checks the name before a row is
written, and `sendTemplate` throws if the parameter count disagrees - so a
renamed or reordered template is a refusal, not a silent mis-send.

| Name | Params, in order | Category | Purpose |
|---|---|---|---|
| `request_received` | `renter_name`, `request_ref`, `listing_count` | Utility | Acknowledges intake. First contact, so there is no open window yet. |
| `itinerary_ready` | `renter_name`, `confirmed_count`, `first_viewing_time` | Utility | The consolidated itinerary with the window shut: how many are confirmed and when the first is. Their reply releases the plan itself (SPEC §9). |
| `viewing_reminder` | `renter_name`, `viewing_time`, `listing_address` | Utility | Since 2026-09-30 the viewing-day message when the window has shut (SPEC §9): sent the morning of, `viewing_time` is "today at 10:00", and `listing_address` carries every viewing that day on one line - where to meet, the agent's name, and their number if they agreed. |
| `no_supply_substitutes` | `renter_name`, `request_ref` | Utility | Nothing could be confirmed and close matches were found, with the window shut. Their reply releases the message carrying the matches (SPEC §9). |
| `weekly_digest` | `renter_name`, `new_count`, `area_summary` | **Marketing** | The weekly new-listing digest. See the warning below. |
| `new_places` | `renter_name`, `new_count`, `area_summary` | **Marketing** | Approved 2026-10-07. The digest twice a week for Pass holders (SPEC §11). `weekly_digest` says "this week", which reads wrong on a Friday. |
| `request_update` | `renter_name`, `complex_name` | Utility | Approved 2026-09-30. An availability request has news after the 24-hour window shut (SPEC §11), a viewing request owes a holding update with the window shut, or its itinerary is held behind it - other times on offer, or nothing found yet (SPEC §9; `{{2}}` is then the listing title or "3 places"). Carries no news itself: the renter replies and the detail goes free-form. |

### `weekly_digest` is not like the other four

The first four all answer something the renter did - they requested, we reply.
The digest arrives unbidden on a Tuesday morning, and that difference matters
in three ways:

- **Submit it as Marketing, not Utility.** It is recurring promotional contact
  whatever the wording. Submitting it as Utility to dodge the consent bar gets
  a WABA restricted, which is a much worse day than a template rejection.
- **It has its own opt-in.** `renters.digest_opt_in_at`, default NULL. A
  viewing request is not consent for a weekly mailshot, and treating it as one
  is how a number's quality rating falls - and the damage lands on the
  itinerary somebody is waiting for, not on the digest.
- **Nothing in the codebase sets that flag.** There is no opt-in checkbox yet.
  Until a renter can deliberately say yes somewhere, the digest sweep will
  correctly find nobody eligible.

The scheduled sweep is a **dry run**: it counts who would be messaged and sends
nothing. Turning it into a real send is a deliberate edit to
`20260915050000_digest_cron.sql`, which is about the right amount of friction
for recurring outbound.

Submit the **first four** as Utility. Marketing templates are billed
differently and are the category that gets numbers limited when recipients
report them - which is exactly why `weekly_digest` is the one that has to go in
as Marketing anyway, per the warning above. Category is decided by what the
message *is*, not by which bill you would rather receive.

### The number's quality rating holds the digest

Since 2026-10-06 the hourly `whatsapp-template-sync` also reads the number's
own rating at Meta (`quality_rating`, and `status` where Meta gives it) into
`whatsapp_number_status`. While Meta rates the number YELLOW or RED, or has
flagged or restricted it, the digest sweep runs dry and reports
`quality_hold` instead of sending (`_shared/whatsapp/number-health.ts`). It
resumes by itself at the first GREEN reading. Itineraries and replies are not
held: they are what the number is for.

The ops console shows the reading on the AI operator page. While the digest is
held, or one of our templates is rated YELLOW or RED or has been paused, a
banner shows on every screen. A number Meta has not rated yet holds nothing.

### The bodies as submitted

The registry pins names and parameter order; the wording lives here. Each ends
by inviting a reply, because a template is what you send when the window is
**closed** - the renter's reply re-opens it, and the real detail (addresses,
times, the full itinerary) then goes free-form with no cost and no length cap.
No variable starts or ends a body and none sit adjacent, which Meta rejects on
without naming the rule. And no `booking` vocabulary: CLAUDE.md forbids it in
renter-facing copy until state is CONFIRMED.

**`request_received`** - Utility. Samples: `Minh`, `HAUSTO-4K7P`, `4`

> Hi {{1}}, we have your viewing request {{2}} for {{3}} places. We are checking
> availability with each one now and will come back to you with times. No need
> to do anything yet.

**`itinerary_ready`** - Utility. Samples: `Minh`, `3`, `Saturday 10:00`

> Hi {{1}}, good news - {{2}} of your viewings are confirmed. The first is
> {{3}}. Reply here and we will send you the full schedule with addresses.

**`viewing_reminder`** - Utility. Samples: `Minh`, `tomorrow at 14:00`,
`Thao Dien, District 2`

> Hi {{1}}, a reminder that your viewing is {{2}} at {{3}}. Reply here if
> anything has changed and we will rearrange it.

**`no_supply_substitutes`** - Utility. Samples: `Minh`, `HAUSTO-4K7P`

> Hi {{1}}, an update on request {{2}} - none of the places you picked could be
> confirmed for your times. We have found some close matches. Reply here and we
> will send them over.

**`weekly_digest`** - **Marketing**. Samples: `Minh`, `3`,
`Thao Dien and District 1`

> Hi {{1}}, there are {{2}} new places this week in {{3}}. Reply here if you
> would like to see them.

**`new_places`** - **Marketing**. Samples: `Minh`, `3`,
`Thao Dien and District 1`. Added 2026-10-06 for the twice-weekly Pass digest,
submitted the same day and approved by Meta on 2026-10-07; `approved` in
`_shared/whatsapp/templates.ts` was flipped on 2026-10-08.

> Hi {{1}}, {{2}} new places in {{3}} fit what you are looking for. Reply here
> if you would like to see them.

**`request_update`** - Utility. Samples: `Minh`, `Empire City`. Added
2026-09-30 for availability requests and approved by Meta the same day;
`approved` in `_shared/whatsapp/templates.ts` was flipped on 2026-10-05.

> Hi {{1}}, we have an update on your request for {{2}}. Reply here to see it.

Meta requires a sample value for every variable before Submit will enable, and
the greyed-out button does not say so. That is the step people miss.

### Once each is approved

**Done, as of 18 September 2026: all five are approved at Meta and all five
flags are `true`.** The rest of this section is the procedure, kept because a
rejected resubmission or a paused template puts you back in it.

Flip its flag in `_shared/whatsapp/templates.ts`:

```ts
REQUEST_RECEIVED: {
  name: 'request_received',
  params: ['renter_name', 'request_ref', 'listing_count'],
  purpose: '...',
  approved: true,   // <- only after Meta says so
},
```

`isApprovedTemplate` is what `sendTemplate` consults, and it refuses anything
still `false` **before** writing a `messages` row. So the flag is not
bookkeeping: until you flip it, that template cannot be sent, and flipping it
early means a row that says SENT for a message Meta rejected.

### The flag is not the only gate any more

`whatsapp-template-sync` runs hourly, asks Meta for the real status of every
template, caches it in `whatsapp_template_status`, and compares it with the
registry. `sendTemplate` now consults both.

The two gates guard different failures, and neither replaces the other:

- **The code flag is a deploy gate.** Meta approving a template does not make
  it sendable - somebody still flips the flag and deploys. A template nobody
  reviewed must not go live because an API said so.
- **Meta's status is the live permission**, and it is the one that can be
  withdrawn after the fact. A template REJECTED on resubmission or PAUSED for
  quality would otherwise stay `true` in the code forever, and the first sign
  would be a `graph_400` on an itinerary a renter was waiting for.

A template with no cached row falls back to the flag alone. A missing row means
"never synced", not "disapproved" - refusing on absence would let a cold
database block every template send, which is a worse failure than the one being
prevented.

What the sync logs, and how loudly:

| Situation | Logged as |
|---|---|
| Flag is `true`, Meta says anything but APPROVED | **error** - this is the one that can actually send and fail |
| Flag is `true`, Meta has never heard of the template | **error** - same reason |
| Flag is `true`, Meta rates quality RED | **error** - RED precedes a pause |
| Meta says APPROVED, flag still `false` | info - the deploy gate working as designed |
| In the registry, not submitted | info - a to-do, not an incident |
| Meta has a template the registry does not | info |

It needs **`WHATSAPP_WABA_ID`** from the table above, the WhatsApp Business
Account id (not the phone number id). Until that and the access token
are set it no-ops and returns 200, so the hourly cron stays quiet rather than
filling the logs with errors about a thing nobody has been able to do yet.

---

## 5. The cutover

Only now, and in this order:

1. Confirm all five other secrets are set and non-empty (digest check above).
2. Confirm at least one template is approved **and** its flag is flipped and
   deployed. With `WHATSAPP_MODE=cloud` and no approved template, a renter whose
   window has closed cannot be reached at all: `sendFreeForm` throws
   `ServiceWindowClosedError` by design and there is nothing to fall back to.
3. Set `WHATSAPP_MODE=cloud`.
4. Send yourself a real request end to end, from a phone you control.

`dev-phone` refuses to run the moment `WHATSAPP_MODE=cloud`, and that is on
purpose: an unauthenticated endpoint that fabricates inbound messages is a
forgery tool against a real number - it would open service windows and write
`RENTER_REPLIED` events for people who said nothing. So **`/dev/phone` stops
being your test surface at exactly the moment you go live.** Step 4 is not
optional; there is no mock rehearsal left after step 3.

---

## 6. Verifying it, and reading the failures

Edge function logs go back about 24 hours. The query that reads them is in
CLAUDE.md, under "Verifying against production" - the endpoint this section
used to show has been removed.

What each failure actually means:

| Symptom | Cause |
|---|---|
| `WHATSAPP_MODE=cloud but WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN is missing` | Half-configured cloud mode. The throw is deliberate. |
| Webhook returns 403, logs `signature verification failed` | `WHATSAPP_APP_SECRET` wrong or empty. Note the signature is over the **raw** body - this cannot be a serialisation bug in our code, that was designed out. |
| Handshake fails, no inbound ever | `WHATSAPP_VERIFY_TOKEN` mismatch, or the `messages` field is not subscribed. |
| `service_window_closed` on every send | Either genuinely no inbound in 24h, or `WHATSAPP_BUSINESS_PHONE` is wrong so nobody can ever open a window. Check the deep link on the confirmation page resolves to your number. |
| `unapproved_template` | The flag in `templates.ts` is still `false`, or the name does not match what Meta approved. |
| `graph_400: ...` in a `messages.error` row | Meta rejected it. The body carries the reason; a bare status tells you nothing. |
| `too_many_consecutive` | Three outbound in a row with no inbound between. This is the consolidation guard working, not a bug to route around. |

The `messages` table is the record either way: every row is written `QUEUED`
before anything leaves, so a `FAILED` row with an `error` is a successful
diagnosis, and a missing row means the send never started.

---

## 7. One date worth knowing

From **2026-10-01** Meta bills service and utility messages sent inside the
24-hour window. Before that date the window is free; after it, every turn is a
line item.

The code already assumes the expensive world - one consolidated itinerary rather
than a sequence, a hard guard at three consecutive outbound, rules-based intent
classification instead of an LLM call per inbound - so nothing needs to change
for it. But it means a chatty flow that looked free in testing starts costing
money, and it is worth going live either comfortably before that date with
volume low, or after it with the consolidation behaviour already proven.

---

## What is still deliberately unbuilt

- **Nothing sends a template automatically when Meta approves one.** The sync
  reports it; flipping the flag and deploying stays a human act. That is the
  deploy gate, not an omission.
- **Nothing sends `request_received` at intake.** Intake writes no message at
  all: there is no window until the renter messages first, and the deep link is
  the handshake. Once `request_received` is approved, sending it at intake
  becomes possible and is a small change - but it is a product decision (it
  costs a utility message per request), not an oversight.
- **Status callbacks are acknowledged, not applied.** `parseInboundMessages`
  returns nothing for delivered/read callbacks, so `messages.status` never
  advances past `SENT`. Harmless today; worth wiring if delivery receipts ever
  matter.
