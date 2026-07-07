## Goal
Fix `subscribers_user_managed_subscription` — prevent authenticated users from self-upgrading to Premium via direct PostgREST calls.

## Root cause
The current RLS policy on `public.subscribers`:
```
FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
```
lets any logged-in user `PATCH /rest/v1/subscribers` and set `subscribed=true`, `subscription_tier='premium'`, `subscription_end='2099-...'` on their own row, bypassing PayPal entirely.

## Fix
Replace the permissive `ALL` policy with a `SELECT`-only policy. All writes continue through the existing PayPal edge functions (`create-paypal-subscription`, `activate-paypal-subscription`, `cancel-paypal-subscription`, `reactivate-paypal-subscription`, `check-paypal-subscription`, `handle-paypal-webhooks`), which use `SUPABASE_SERVICE_ROLE_KEY` and bypass RLS.

## Migration
```sql
DROP POLICY IF EXISTS "Authenticated users can manage their subscription"
  ON public.subscribers;

CREATE POLICY "Users can view their own subscription"
  ON public.subscribers
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
```

Note: the existing `handle_new_subscriber` trigger runs as `SECURITY DEFINER`, and `set_subscription_end_on_manual_upgrade` fires on UPDATE from the service role — both continue to work.

## Verification
- `useSubscription` reads (`.from('subscribers').select(...)`) still work for signed-in users.
- All PayPal edge functions still write successfully (service role bypasses RLS).
- A crafted `PATCH /rest/v1/subscribers` from a normal user's JWT now returns `permission denied`.
- Mark `subscribers_user_managed_subscription` as fixed via `manage_security_finding`.

## Out of scope
Every other open security finding (external contact fields, fast-track premium check, realtime policies, storage buckets, function search_path, Postgres upgrade, leaked-password protection) — not touched.
