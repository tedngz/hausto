# Mail to hello@hausto.com

Everything sent to `hello@hausto.com` has to end up in `ted.ngz@gmail.com`, and
replies have to leave as `hello@hausto.com` so no renter ever sees a personal
address. This is how that is wired.

## The path a message takes

```
someone -> MX for hausto.com -> Resend receiving -> email.received webhook
                                                          |
                                            concierge-email-inbound
                                                          |
                         matched to a complex_inquiries row?
                         |                                |
                        yes                               no
                         |                                |
         filed on the thread + "💬 X replied"     "📥 Unmatched mail"
                         |                                |
                         +---------> ted.ngz@gmail.com <--+
```

The MX record is `inbound-smtp.ap-northeast-1.amazonaws.com` at priority 10.
That is Resend's receiving host - Resend runs receiving on SES infrastructure -
so it looks like a plain Amazon SES record but is not one. Do not "fix" it.

## What broke in August 2026

Mail stopped reaching `ted.ngz@gmail.com`. It turned out nothing was wrong with
DNS, the domain, or the function: Resend had been receiving every message
correctly, and the `email.received` webhook was pointed at `https://hausto.com/`
- the marketing site root, which does nothing with a POST. Nine messages sat in
Resend, received and delivered nowhere.

Worth knowing for next time:

- Resend stores received mail whether or not the webhook succeeds. `GET
  /emails/receiving` lists it, so mail is recoverable even when the pipeline is
  down. That listing is the fastest way to tell "nobody emailed us" apart from
  "we lost it".
- `scripts/setup-ses-inbound.sh` used to describe this pipeline as SES receipt
  rule -> SNS -> function. That was never the live path, and chasing it wasted
  the first hour of the investigation. The script has been removed.
- A receipt rule may still exist in the AWS account from that attempt. It is
  inert - Resend's account owns receiving for the domain - but worth deleting if
  you are ever in there.

## Secrets

| Secret | Used for |
| --- | --- |
| `RESEND_API_KEY` | Sending. Send-only key, shared by every function. |
| `RESEND_RECEIVING_API_KEY` | Reading received bodies. Needs **full access**. |
| `RESEND_WEBHOOK_SECRET` | Verifying the Svix signature on the webhook. |
| `CONCIERGE_INBOUND_SECRET` | Alternative auth as `?secret=` or `x-webhook-secret`. |

The two API keys are separate on purpose. Resend grants either "sending" or
"full" access with nothing in between, and reading a received body needs full;
splitting them keeps the key every other function holds restricted to sending.
A send-only key on the receiving endpoint returns
`401 restricted_api_key: "This API key is restricted to only send emails"`,
which surfaces as a message filed with no body.

`concierge-email-inbound` runs without a JWT (mail providers cannot mint one),
so every request must carry either a valid Svix signature or the shared secret.
Either is accepted, which is what lets the provider in front of the domain be
swapped without a window where mail is dropped.

## Rebuilding the webhook

If the webhook is ever lost or repointed, create it via the API rather than the
dashboard - the response is the only place the signing secret ever appears:

```bash
curl -X POST https://api.resend.com/webhooks \
  -H "Authorization: Bearer $RESEND_FULL_ACCESS_KEY" \
  -H "content-type: application/json" \
  -d '{"endpoint":"https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/concierge-email-inbound","events":["email.received"]}'
```

Then store the returned `signing_secret` as `RESEND_WEBHOOK_SECRET` in Supabase
-> Edge Functions -> Secrets, and delete the old webhook so the event is not
delivered twice.

To check what is currently configured: `GET https://api.resend.com/webhooks`.

## Replaying mail that did not arrive

`email.received` payloads are metadata only, so a replay just needs the stored
message's id from `GET /emails/receiving`. Sign it the Svix way - HMAC-SHA256
over `<svix-id>.<svix-timestamp>.<body>`, keyed by the base64-decoded part of
`whsec_…` after the prefix - and POST it at the function.

One caution: replaying a message **from** `ted.ngz@gmail.com` or any
`@hausto.com` address takes the outbound branch, which relays it onward to the
renter. Only replay renter mail unless you mean to send.

## Replying as hello@hausto.com from Gmail

This has to be done from Ted's own Gmail - it needs an SMTP password typed into
Google's settings, so it cannot be scripted.

1. Gmail -> Settings -> Accounts and Import -> "Send mail as" -> Add another
   email address.
2. Name `Hausto`, address `hello@hausto.com`. Untick "Treat as an alias" - this
   is a role address, not a second address for the same person.
3. SMTP server `smtp.resend.com`, port `587`, username `resend`, password is a
   Resend API key (the send-only one is enough), TLS.
4. Google emails a confirmation code to `hello@hausto.com`. It matches no
   inquiry, so it arrives as a "📥 Unmatched mail" forward.
5. Under "When replying to a message", pick "Reply from the same address the
   message was sent to" if you want replies to default to the concierge
   identity. Notifications are addressed to `ted.ngz@gmail.com`, so you will
   still pick `hello@hausto.com` from the From dropdown when answering a
   forwarded cold email.

Threaded replies do not need this. Hitting Reply on a "💬 X replied"
notification goes to the thread alias, and the function relays it onward as the
concierge and logs it against the request. Send-as matters for cold mail and for
starting a new conversation.

## How a reply finds its request

In order:

1. `hello+inq-<uuid>@hausto.com` in any recipient field, including
   `received_for` - the envelope recipient, and the only place the alias shows
   up when the header `To:` is the plain inbox.
2. `[inq-<uuid>]` appended to the subject of admin notifications. Plus
   addressing depends on the provider treating `hello+tag@` as `hello@`, which
   is not documented for Resend receiving; a subject tag survives Reply in every
   client regardless. Renters never see it - their relayed copy is given a
   freshly written subject.
3. The sender address, matched to their newest still-open request. This is the
   normal path for renters, who only ever see the plain concierge address.

## Things that are deliberate

- Mail from `hello@hausto.com` that matches no request is dropped rather than
  forwarded. Our own notifications go out from that address, and forwarding one
  back to ourselves would loop forever.
- A redelivery of a message we already stored still re-sends the notification.
  A provider retries after a non-200, and the thing most likely to have failed
  is the notification itself - stopping at the duplicate guard would make the
  retry a no-op and lose the alert. A second copy is the safer error.
- Failures to send are raised, not logged. The Resend SDK reports a rejection
  in its result instead of throwing, so a plain `await` looks like success and
  the provider is told the mail was delivered.
- A body we could not fetch is recorded as "could not read the body" with a link
  to the message in Resend, not as "(empty message)". The two mean opposite
  things and only one of them is your problem.

## Mail that matches no availability request

A cold email has no `complex_inquiries` row, so there is no `hello+inq-…` alias
to answer it through. Before August 2026 its notification carried
`Reply-To: <the sender>`, which meant hitting Reply in Gmail sent **from the
admin's personal address straight to a stranger**, quoting the internal
notification - subject, "this sender has 2 requests on file", and all - and left
no record anywhere.

Such mail now gets a row in `public.concierge_mail_threads` and an alias of its
own, `hello+box-<uuid>@hausto.com`, with a `[box-…]` copy in the subject. A
reply comes back here, goes out as `hello@hausto.com` under the contact's own
subject, and their answer lands back on the same thread.

Threads are keyed on `(contact_email, subject_key)`, where `subject_key` is the
subject with `Re:` and any token stripped, lowercased. A back-and-forth stays on
one row; a genuinely new topic from the same person opens another.

Only the edge functions read this table, via the service role. RLS is enabled
with no policies, so nothing is reachable with an anon key.

## Gmail's invisible trailing character

Gmail appends U+1427 (Canadian syllabics final middle dot) to some replies. It
looks exactly like a period and is not one, so it has to be matched explicitly -
no punctuation class catches it. Left in, it relays to the renter as a stray "."
on its own line. `stripQuotedReply` trims it along with U+200B and U+034F.
