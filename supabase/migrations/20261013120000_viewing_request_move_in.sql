-- When the renter expects to move in, asked on every new viewing request.
--
-- The first thing an agent weighs: a unit free now is no use to someone
-- moving in two months out. It goes into the first message to each agent
-- (realtor/drafts.ts draftForRealtor), the operators' alert and the console.
--
-- Nullable: requests made before it was asked have none, and the function
-- still accepts a request without one (intake.ts validateMoveIn). It is what
-- the renter told us, not state - REQUEST_SUBMITTED carries it too, beside
-- the availability, as the record of what was asked.

ALTER TABLE public.viewing_requests
  ADD COLUMN IF NOT EXISTS move_in_date date;

COMMENT ON COLUMN public.viewing_requests.move_in_date IS
  'When the renter expects to move in (local date). Null on requests made before it was asked.';

-- The console's request header reads it from here. New columns go last, so
-- CREATE OR REPLACE keeps the view's existing shape.
CREATE OR REPLACE VIEW public.ops_request_queue
WITH (security_invoker = true) AS
SELECT
  vr.id,
  vr.ref,
  vr.availability,
  vr.created_at,
  EXTRACT(EPOCH FROM (now() - vr.created_at))::bigint AS age_seconds,
  count(ri.id)                                        AS item_count,
  count(ri.id) FILTER (WHERE ri.realtor_id IS NULL)   AS unresolved_realtor_count,
  vr.move_in_date
FROM public.viewing_requests vr
LEFT JOIN public.request_items ri ON ri.request_id = vr.id
GROUP BY vr.id, vr.ref, vr.availability, vr.created_at, vr.move_in_date;
