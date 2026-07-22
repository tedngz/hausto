-- Renters can archive Fast-Track requests they can't delete (scheduled /
-- in_progress / completed), so their profile list stays tidy without losing the
-- booking record the coordinator and agents work against.
ALTER TABLE public.fast_track_requests
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Archiving goes through a SECURITY DEFINER function rather than a broad UPDATE
-- policy: RLS can't restrict which columns a policy exposes, and the existing
-- renter UPDATE policy is deliberately narrow (pending + premium only). This
-- lets renters flip only archived_at, and only on their own rows.
CREATE OR REPLACE FUNCTION public.set_fast_track_archived(_request_id uuid, _archived boolean)
RETURNS TABLE (id uuid, archived_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.fast_track_requests
  SET archived_at = CASE WHEN _archived THEN now() ELSE NULL END
  WHERE fast_track_requests.id = _request_id
    AND fast_track_requests.renter_id = auth.uid()
  RETURNING fast_track_requests.id, fast_track_requests.archived_at;
$$;

REVOKE ALL ON FUNCTION public.set_fast_track_archived(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_fast_track_archived(uuid, boolean) TO authenticated;
