-- Step 1: Deduplicate match_conversations by renter/realtor pair
-- Re-point direct_messages to the earliest conversation for each pair
WITH pairs AS (
  SELECT renter_id, realtor_id, MIN(created_at) AS first_created
  FROM public.match_conversations
  GROUP BY renter_id, realtor_id
),
keepers AS (
  SELECT mc.renter_id, mc.realtor_id, mc.id AS keep_id
  FROM public.match_conversations mc
  JOIN pairs p
    ON mc.renter_id = p.renter_id
   AND mc.realtor_id = p.realtor_id
   AND mc.created_at = p.first_created
),
duplicates AS (
  SELECT mc.id AS duplicate_id, k.keep_id
  FROM public.match_conversations mc
  JOIN keepers k
    ON mc.renter_id = k.renter_id
   AND mc.realtor_id = k.realtor_id
  WHERE mc.id <> k.keep_id
)
UPDATE public.direct_messages dm
SET conversation_id = d.keep_id
FROM duplicates d
WHERE dm.conversation_id = d.duplicate_id;

-- Step 2: Delete duplicate conversations
WITH pairs AS (
  SELECT renter_id, realtor_id, MIN(created_at) AS first_created
  FROM public.match_conversations
  GROUP BY renter_id, realtor_id
),
keepers AS (
  SELECT mc.renter_id, mc.realtor_id, mc.id AS keep_id
  FROM public.match_conversations mc
  JOIN pairs p
    ON mc.renter_id = p.renter_id
   AND mc.realtor_id = p.realtor_id
   AND mc.created_at = p.first_created
),
duplicates AS (
  SELECT mc.id AS duplicate_id
  FROM public.match_conversations mc
  JOIN keepers k
    ON mc.renter_id = k.renter_id
   AND mc.realtor_id = k.realtor_id
  WHERE mc.id <> k.keep_id
)
DELETE FROM public.match_conversations mc
USING duplicates d
WHERE mc.id = d.duplicate_id;

-- Step 3: Deduplicate property_matches by renter/realtor/property triplet
WITH pm_groups AS (
  SELECT renter_id, realtor_id, property_id, MIN(created_at) AS first_created
  FROM public.property_matches
  GROUP BY renter_id, realtor_id, property_id
),
pm_keepers AS (
  SELECT pm.renter_id, pm.realtor_id, pm.property_id, pm.id AS keep_id
  FROM public.property_matches pm
  JOIN pm_groups g
    ON pm.renter_id = g.renter_id
   AND pm.realtor_id = g.realtor_id
   AND pm.property_id = g.property_id
   AND pm.created_at = g.first_created
),
pm_duplicates AS (
  SELECT pm.id AS duplicate_id
  FROM public.property_matches pm
  JOIN pm_keepers k
    ON pm.renter_id = k.renter_id
   AND pm.realtor_id = k.realtor_id
   AND pm.property_id = k.property_id
  WHERE pm.id <> k.keep_id
)
DELETE FROM public.property_matches pm
USING pm_duplicates d
WHERE pm.id = d.duplicate_id;

-- Step 4: Add unique constraint on property_matches if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'property_matches_unique_triplet'
  ) THEN
    ALTER TABLE public.property_matches
      ADD CONSTRAINT property_matches_unique_triplet UNIQUE (renter_id, realtor_id, property_id);
  END IF;
END $$;