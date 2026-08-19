# Mail to hello@hausto.com

Everything sent to `hello@hausto.com` has to end up in `ted.ngz@gmail.com`, and
replies have to leave as `hello@hausto.com` so no renter ever sees a personal
address. This is how that is wired.

## The path a message takes

```
someone -> MX for hausto.com -> provider webhook -> concierge-email-inbound
                                                         |
                        matched to a complex_inquiries row?
                        |                                |
                       yes                               no
                        |                                |
        filed on the thread + "💬 X replied"     "📥 Unmatched mail"
                        |                                |
                        +---------> ted.ngz@gmail.com <--+
```

`concierge-email-inbound` runs without a JWT (mail providers cannot mint one),
so every request must carry either:

- `?secret=` or `x-webhook-secret` matching `CONCIERGE_INBOUND_SECRET`, or
- Svix signature headers verified against `RESEND_WEBHOOK_SECRET`.

Both are accepted, which is what lets the provider in front of the domain be
swapped without a window where mail is dropped.

## Why we are moving off SES

The original path was `MX -> SES -> SNS topic -> function`, set up by
`scripts/setup-ses-inbound.sh`. It works, but it fails quietly in three ways:

1. The SNS HTTPS subscription has to be confirmed by hand, and the confirmation
   token only appears in the function logs. Nothing tells you if it lapses.
2. The subscription URL embeds `CONCIERGE_INBOUND_SECRET`. Rotating that secret
   in Supabase silently 403s every delivery from then on.
3. `SNSAction` inlines the message and caps out around 150KB. A message with an
   attachment or an inline logo above that is dropped by SES with no
   notification at all.

Resend already sends every outbound mail for the domain, and the function
already parses its inbound webhook, so receiving there removes a whole provider
and its manual handshake.

## Migrating inbound to Resend

1. **Add the receiving domain.** Resend dashboard -> Domains -> `hausto.com` ->
   enable receiving. Resend shows an MX record specific to your account.
2. **Swap the MX record.** Replace the current
   `10 inbound-smtp.ap-northeast-1.amazonaws.com` on the root with the record
   Resend shows. It must be the lowest-priority MX on the domain or Resend
   receives nothing. DNS is on Namecheap (`dns1/dns2.registrar-servers.com`).
   Leave `send.hausto.com` alone - that is the outbound Return-Path and its SPF
   record is unrelated.
3. **Add the webhook.** Resend dashboard -> Webhooks -> Add, event
   `email.received`, endpoint:

   ```
   https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/concierge-email-inbound?secret=<CONCIERGE_INBOUND_SECRET>
   ```

   The secret can be revealed in Supabase -> Edge Functions -> Secrets.
4. **Optional hardening.** Copy the signing secret Resend shows for the webhook
   into a Supabase secret named `RESEND_WEBHOOK_SECRET`. The function then
   verifies the signature and the `?secret=` in the URL becomes belt-and-braces.
5. **Tear down the AWS side** once mail is arriving: delete the
   `concierge-to-sns` receipt rule and the `hausto-concierge-inbound` SNS topic.

Resend's `email.received` webhook carries metadata only, so the function fetches
the body from `GET /emails/receiving/{email_id}` using `RESEND_API_KEY`. If that
fetch fails the message is still filed and forwarded, just without its body.

## Replying as hello@hausto.com from Gmail

This has to be done from Ted's own Gmail - it needs an SMTP password typed into
Google's settings, so it cannot be scripted.

1. Gmail -> Settings -> Accounts and Import -> "Send mail as" -> Add another
   email address.
2. Name `Hausto`, address `hello@hausto.com`. Untick "Treat as an alias" - this
   is a role address, not a second address for the same person.
3. SMTP server `smtp.resend.com`, port `587`, username `resend`, password is a
   Resend API key, TLS.
4. Google emails a confirmation code to `hello@hausto.com`. It arrives with no
   matching inquiry, so it comes through as a "📥 Unmatched mail" forward -
   which means step 3 of the migration above has to be working first.
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

1. `hello+inq-<uuid>@hausto.com` in any recipient field.
2. `[inq-<uuid>]` appended to the subject of admin notifications. Plus
   addressing depends on the provider treating `hello+tag@` as `hello@`, which
   SES and Resend document differently; a subject tag survives Reply in every
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
