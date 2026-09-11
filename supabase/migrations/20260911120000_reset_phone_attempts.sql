-- Give back the retries that were spent on our own bugs.
--
-- Every phone_extraction_attempt on record was incurred today, during testing,
-- and every one of them failed for a reason that says nothing about the
-- listing:
--
--   * the injected browser script threw on an invalid regex before it could
--     read anything (the String.raw fix), so the page was never inspected
--   * batdongsan returned 403 on the listing page while passing the
--     domain-level check - it was refusing us, not telling us the seller has
--     no number
--
-- Two batdongsan rows had already reached the cap of 3 and would never have
-- been offered another attempt; six more were partway there. extract-phone now
-- distinguishes "refused" from "nothing found" and leaves the counter alone for
-- the former, so this should not need repeating.
UPDATE public.external_properties
SET phone_extraction_attempts = 0,
    updated_at = now()
WHERE phone_extraction_attempts > 0
  AND (contact_phone IS NULL OR contact_phone LIKE '%*%');
