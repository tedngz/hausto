-- Retire the last PayPal-era moving part.
--
-- expire-subscriptions ran hourly to flip lapsed `subscribers` rows to
-- unsubscribed. The $10/mo plan is gone, its last cycle lapsed, and the edge
-- function has been deleted - so the job now POSTs to a URL that 404s, once an
-- hour, forever. Unschedule it.
--
-- The `subscribers` table itself is left in place on purpose: it holds the
-- record of who was once billed, which is worth keeping even though nothing
-- reads it for entitlement any more. Dropping it is a separate decision.

SELECT cron.unschedule('expire-subscriptions-hourly');
