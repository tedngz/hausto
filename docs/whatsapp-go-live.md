# Taking WhatsApp live

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
5. **Submit the four templates** (see below). Approval is typically hours but
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

## 4. The four templates

Submit these **with these exact names and this exact parameter order**. The
registry in `_shared/whatsapp/templates.ts` checks the name before a row is
written, and `sendTemplate` throws if the parameter count disagrees - so a
renamed or reordered template is a refusal, not a silent mis-send.

| Name | Params, in order | Category | Purpose |
|---|---|---|---|
| `request_received` | `renter_name`, `request_ref`, `listing_count` | Utility | Acknowledges intake. First contact, so there is no open window yet. |
| `itinerary_ready` | `renter_name`, `confirmed_count`, `first_viewing_time` | Utility | The consolidated itinerary. One message carrying every confirmed viewing. |
| `viewing_reminder` | `renter_name`, `viewing_time`, `listing_address` | Utility | Day-before reminder, typically outside the window. |
| `no_supply_substitutes` | `renter_name`, `request_ref` | Utility | Nothing could be confirmed. Never sent alone - it carries substitutes. |

Submit them as **Utility**, not Marketing. Marketing templates are billed
differently and are the category that gets numbers limited when recipients
report them.

### Once each is approved

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

It needs one secret beyond the six above: **`WHATSAPP_WABA_ID`**, the WhatsApp
Business Account id (not the phone number id). Until that and the access token
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

Edge function logs are retained for roughly **three minutes**. Catching a
failure means tailing while you reproduce it, not looking afterwards:

```sh
TOKEN=$(cat "$HOME/.supabase/access-token") node -e "
const u=new URL('https://api.supabase.com/v1/projects/gbgrwjdmytaksrztcyzs/analytics/endpoints/logs.all');
u.searchParams.set('sql','select timestamp, event_message from function_logs order by timestamp desc limit 100');
fetch(u,{headers:{Authorization:'Bearer '+process.env.TOKEN}}).then(r=>r.json()).then(b=>
  (b.result||[]).reverse().forEach(r=>console.log(new Date(Number(r.timestamp)/1000).toISOString(), r.event_message)));
"
```

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
