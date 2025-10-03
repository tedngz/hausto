-- Ensure unique conversation per renter-realtor pair
CREATE UNIQUE INDEX IF NOT EXISTS match_conversations_unique_pair
ON public.match_conversations (renter_id, realtor_id);

-- Prevent duplicate property match rows for the same renter/realtor/property
CREATE UNIQUE INDEX IF NOT EXISTS property_matches_unique_triple
ON public.property_matches (renter_id, realtor_id, property_id);