-- Re-derive style tags for existing listings from their STORED vibe metric
-- scores, using the discriminating rule the crawler now applies to new
-- listings (>=7 AND >= mean+1, top 2; fallback: single top style >=6, else
-- Contemporary). No OpenAI calls needed - only the derivation rule changed.
WITH scored AS (
  SELECT id,
    (SELECT jsonb_object_agg(k, COALESCE((vibe_analysis->>k)::numeric, 5))
     FROM unnest(ARRAY['modern','cozy','luxurious','minimalist','spacious','elegant','urban','rustic']) k) AS scores
  FROM external_properties
  WHERE is_active
    AND vibe_analysis ? 'modern'
),
stats AS (
  SELECT id, scores,
    (SELECT avg(v::numeric) FROM jsonb_each_text(scores) AS e(k, v)) AS mean
  FROM scored
),
derived AS (
  SELECT s.id,
    COALESCE(
      NULLIF((
        SELECT array_agg(initcap(k) ORDER BY v::numeric DESC)
        FROM (
          SELECT k, v FROM jsonb_each_text(s.scores) AS e(k, v)
          WHERE v::numeric >= 7 AND v::numeric >= s.mean + 1
          ORDER BY v::numeric DESC LIMIT 2
        ) top
      ), '{}'),
      (SELECT CASE WHEN max(v::numeric) >= 6
              THEN ARRAY[initcap((array_agg(k ORDER BY v::numeric DESC))[1])]
              ELSE ARRAY['Contemporary'] END
       FROM jsonb_each_text(s.scores) AS e(k, v))
    ) AS styles
  FROM stats s
)
UPDATE external_properties ep
SET vibe_analysis = jsonb_set(COALESCE(ep.vibe_analysis, '{}'::jsonb), '{styles}', to_jsonb(d.styles)),
    vibe = array_to_string(d.styles, ', '),
    vibe_status = CASE
      WHEN jsonb_array_length(COALESCE(ep.vibe_analysis->'image_analyses', '[]'::jsonb)) > 0 THEN 'complete'
      ELSE ep.vibe_status
    END
FROM derived d
WHERE ep.id = d.id;
