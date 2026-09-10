-- Fifty listings were switched off and forgotten.
--
-- backfill-image-highlights hides a listing when its highlight pass fails
-- (is_active = false, vibe_status = 'pending') and enqueues it for a retry. The
-- enqueue is fire-and-forget, so when the insert failed the row was left hidden
-- with nothing scheduled to look at it again. Forty-five housingsgn rows from
-- one week in early July are in exactly that state: vibe_status 'pending', no
-- queue row - and image_analyses already populated, so the work they were
-- waiting for had in fact been done.
--
-- Recovery condition is deliberately narrow: still verified alive, never
-- deactivated, carries real per-image analysis, and clears the display floor of
-- five images. Rows that are hidden for a good reason stay hidden - nine of the
-- fifty have too few images and are left alone.
UPDATE public.external_properties
SET is_active = true,
    vibe_status = 'complete',
    updated_at = now()
WHERE is_active = false
  AND deactivated_at IS NULL
  AND last_verification_status = 'alive'
  AND jsonb_array_length(vibe_analysis -> 'image_analyses') > 0
  AND coalesce(array_length(images, 1), 0) >= 5;

-- Drop the stale queue rows for anything now live, so the next drain does not
-- reprocess a listing that needs nothing.
DELETE FROM public.vibe_analysis_queue q
USING public.external_properties p
WHERE q.property_id = p.id
  AND p.is_active = true
  AND p.vibe_status = 'complete';
