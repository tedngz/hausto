
CREATE OR REPLACE FUNCTION public.get_conversation_properties()
 RETURNS TABLE(conversation_id uuid, renter_id uuid, realtor_id uuid, match_id uuid, property_id uuid, price numeric, matched_at timestamp with time zone, images text[], title text, location text, property_source_provider_name text, property_source_provider_phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  -- Internal properties
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
    p.location,
    p.property_source_provider_name,
    p.property_source_provider_phone
  FROM match_conversations mc
  JOIN property_matches pm ON (pm.renter_id = mc.renter_id AND pm.realtor_id = mc.realtor_id AND pm.property_type = 'internal')
  JOIN properties p ON p.id = pm.property_id
  WHERE auth.uid() = mc.renter_id OR auth.uid() = mc.realtor_id

  UNION ALL

  -- External/crawled properties
  SELECT 
    mc.id as conversation_id,
    mc.renter_id,
    mc.realtor_id,
    pm.id as match_id,
    ep.id as property_id,
    ep.price,
    pm.created_at as matched_at,
    ep.images,
    ep.title,
    ep.location,
    ep.contact_name as property_source_provider_name,
    ep.contact_phone as property_source_provider_phone
  FROM match_conversations mc
  JOIN property_matches pm ON (pm.renter_id = mc.renter_id AND pm.realtor_id = mc.realtor_id AND pm.property_type = 'external')
  JOIN external_properties ep ON ep.id = pm.property_id
  WHERE auth.uid() = mc.renter_id OR auth.uid() = mc.realtor_id;
$$;
