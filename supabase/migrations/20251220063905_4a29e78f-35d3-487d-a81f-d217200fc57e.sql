-- Create cron job to expire subscriptions every hour
SELECT cron.schedule(
  'expire-subscriptions-hourly',
  '0 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/expire-subscriptions',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZ3J3amRteXRha3NyenRjeXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDQwNDcsImV4cCI6MjA2NzYyMDA0N30.pJnXggzvzGxHrOaF_ygThG7Ws66Y4VFH102iQtPS118"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);