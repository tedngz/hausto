-- The grants `ops_request_items_view` needed and never had.
--
-- Found while reading PR #91, which hit the same wall from the renter side and
-- documented the cause. `external_properties` has NO table-wide SELECT grant to
-- anon or authenticated - only per-column grants that deliberately omit
-- `contact_phone` and `contact_name`, so the broker's details are unreadable
-- before RLS is even consulted (20260818160000 explains why, and warns against
-- the one-line GRANT that would undo it).
--
-- The consequence nobody had hit yet: **a new column on this table starts
-- unreadable.** That is the right default and it is documented as failing safe.
-- But `district_code`, `bedrooms` and `area_sqm` arrived with S3, and
-- `ops_request_items_view` is `security_invoker = true` - it reads with the
-- *operator's* privileges, not the view owner's. So the ops console's item
-- cards and its whole delivery panel would have failed with
--
--   42501  permission denied for table external_properties
--
-- a TABLE-level error for a COLUMN-level problem, on a table the operator can
-- otherwise read perfectly well. It would not have shown up in any test here:
-- every test runs against an in-memory fake, and every edge function reads this
-- view with the service role, which has table-wide access. Only a signed-in
-- operator hits it, which is to say it would have surfaced on the first real
-- use of the console.
--
-- Granting the columns rather than making the view SECURITY DEFINER, and that
-- choice matters: a definer view would also bypass RLS on `request_items` and
-- `viewing_requests`, handing every authenticated user every renter's request
-- graph. The column grant widens exactly what it says and nothing else.
--
-- All five are public listing facts already served by `public-property-search`.
-- Nothing here touches the contact columns, and nothing here grants the table.

GRANT SELECT (title, source_url, district_code, bedrooms, area_sqm)
  ON public.external_properties TO authenticated;

-- Deliberately NOT granted, each for its own reason - the same list PR #91
-- reasons through from the renter side:
--
--   contact_phone, contact_name, contact_phone_e164
--       broker contact. Released only via get_external_property_contacts().
--       A generated column is not a loophole in the rule.
--   realtor_id, source_agent_id
--       broker identity. Invariant 4 keeps it off renter surfaces, and the ops
--       console reads the broker through `realtors` instead, which has its own
--       ops policy.
--   delisted_at, price_confirmed_at
--       our own bookkeeping about freshness; no caller outside the crawler and
--       the verifier has a use for it.

COMMENT ON VIEW public.ops_request_items_view IS
  'Ops realtor-facing view. Deliberately omits every renters column - see CLAUDE.md invariant 4. '
  'security_invoker = true, so it needs column grants on external_properties for `authenticated`; '
  'see 20260912130000_ops_view_column_grants.sql before adding a column to this view.';
