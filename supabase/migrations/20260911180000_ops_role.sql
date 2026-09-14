-- S5, part 1 of 2: the `ops` role exists.
--
-- Deliberately alone in its own migration. `ALTER TYPE ... ADD VALUE` commits
-- the new label, but Postgres refuses to let the *same transaction* then use
-- it - "unsafe use of new value of enum type". `supabase db push` runs each
-- file in its own transaction, so the policies that reference 'ops'::app_role
-- live in the next file. Merging the two is the kind of change that passes
-- review and fails the deploy.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'ops'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'ops';
  END IF;
END
$$;
