-- A third shape of "no phone", and the selector that keeps missing them.
--
-- extract-phone picks work with `contact_phone IS NULL OR contact_phone LIKE
-- '%*%'`. That was already a fix - it used to be NULL only, which skipped the
-- 404 masked rows. But the column also holds prose:
--
--   'Not provided' x3, 'N/A' x2, 'Not available', 'Not Available',
--   '25 listings', and '091876968' - nine digits, not a phone number
--
-- None of those are null and none contain a star, so those rows are invisible
-- to extraction for a third reason. Rather than add a third clause and wait for
-- a fourth shape, the question becomes one column: is there a dialable number
-- here or not.
--
-- normalize_vn_phone is IMMUTABLE, which is what allows a stored generated
-- column. It stays in lockstep with contact_phone for free - no trigger, no
-- backfill job, and no way for the two to disagree.
ALTER TABLE public.external_properties
  ADD COLUMN IF NOT EXISTS contact_phone_e164 text
  GENERATED ALWAYS AS (public.normalize_vn_phone(contact_phone)) STORED;

-- The extraction queue's read: active listings with no usable number.
CREATE INDEX IF NOT EXISTS external_properties_needs_phone_idx
  ON public.external_properties (phone_extraction_attempts, created_at DESC)
  WHERE is_active AND contact_phone_e164 IS NULL;

-- And the realtor join, which is the reason the E.164 form is worth storing:
-- the contact list arriving by hand will be matched against this, not against
-- whatever the crawler wrote.
CREATE INDEX IF NOT EXISTS external_properties_contact_e164_idx
  ON public.external_properties (contact_phone_e164)
  WHERE contact_phone_e164 IS NOT NULL;
