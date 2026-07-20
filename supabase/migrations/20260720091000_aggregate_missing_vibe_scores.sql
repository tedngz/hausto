-- Some listings have per-image analyses but never got aggregated top-level
-- metric scores (interrupted pipeline runs). Aggregate = avg across images,
-- then the same standout style derivation as 20260720090000.
WITH per_metric AS (
  SELECT ep.id, k, round(avg(COALESCE((ia->>k)::numeric, 5))) AS score
  FROM external_properties ep
  CROSS JOIN LATERAL jsonb_array_elements(ep.vibe_analysis->'image_analyses') ia
  CROSS JOIN unnest(ARRAY['modern','cozy','luxurious','minimalist','spacious','elegant','urban','rustic']) k
  WHERE ep.is_active
    AND ep.vibe IS NULL
    AND jsonb_array_length(COALESCE(ep.vibe_analysis->'image_analyses', '[]'::jsonb)) > 0
  GROUP BY ep.id, k
),
agg AS (
  SELECT id, jsonb_object_agg(k, score) AS scores
  FROM per_metric
  GROUP BY id
),
stats AS (
  SELECT id, scores,
    (SELECT avg(v::numeric) FROM jsonb_each_text(scores) AS e(k, v)) AS mean
  FROM agg WHERE scores IS NOT NULL
),
derived AS (
  SELECT s.id, s.scores,
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
SET vibe_analysis = jsonb_set(COALESCE(ep.vibe_analysis, '{}'::jsonb) || d.scores, '{styles}', to_jsonb(d.styles)),
    vibe = array_to_string(d.styles, ', '),
    vibe_status = 'complete'
FROM derived d
WHERE ep.id = d.id;
