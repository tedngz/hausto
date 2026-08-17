-- Listings older than the dedupe history window are not loaded by the rebuild,
-- so when a group they belonged to is deleted their canonical_group_id is left
-- dangling. Clearing that in SQL avoids shipping an unbounded id list through
-- PostgREST from the edge function.

CREATE OR REPLACE FUNCTION public.prune_orphan_listing_group_refs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.external_properties p
  SET canonical_group_id = NULL
  WHERE p.canonical_group_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.listing_groups g WHERE g.id = p.canonical_group_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_orphan_listing_group_refs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_orphan_listing_group_refs() TO service_role;
