-- Drop the existing conversation_properties view if it exists
DROP VIEW IF EXISTS conversation_properties CASCADE;

-- Create a secure function to get conversation properties
CREATE OR REPLACE FUNCTION public.get_conversation_properties()
RETURNS TABLE (
  conversation_id uuid,
  renter_id uuid,
  realtor_id uuid,
  match_id uuid,
  property_id uuid,
  price numeric,
  matched_at timestamp with time zone,
  images text[],
  title text,
  location text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    mc.id as conversation_id,
    mc.renter_id,
    mc.realtor_id,
    pm.id as match_id,
    p.id as property_id,
    p.price,
    pm.created_at as matched_at,
    p.images,
    p.title,
    p.location
  FROM match_conversations mc
  JOIN property_matches pm ON (pm.renter_id = mc.renter_id AND pm.realtor_id = mc.realtor_id)
  JOIN properties p ON p.id = pm.property_id
  WHERE auth.uid() = mc.renter_id OR auth.uid() = mc.realtor_id;
$$;