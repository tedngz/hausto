-- Fix colors stored as string -> wrap in array
UPDATE external_properties
SET vibe_analysis = jsonb_set(
  vibe_analysis,
  '{colors}',
  to_jsonb(string_to_array(vibe_analysis->>'colors', ','))
),
updated_at = now()
WHERE jsonb_typeof(vibe_analysis->'colors') = 'string';

-- Fix activities stored as string -> wrap in array
UPDATE external_properties
SET vibe_analysis = jsonb_set(
  vibe_analysis,
  '{activities}',
  to_jsonb(string_to_array(vibe_analysis->>'activities', ','))
),
updated_at = now()
WHERE jsonb_typeof(vibe_analysis->'activities') = 'string';

-- Add styles array from style string where styles is missing
UPDATE external_properties
SET vibe_analysis = jsonb_set(
  vibe_analysis,
  '{styles}',
  to_jsonb(ARRAY[vibe_analysis->>'style'])
),
updated_at = now()
WHERE vibe_analysis->'styles' IS NULL
  AND vibe_analysis->>'style' IS NOT NULL;