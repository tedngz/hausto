-- Realtor contacts, resolved by hand and imported from the tracking sheet.
--
-- The sheet is filled in gradually, so this is built as a staging table plus a
-- function rather than a one-off script: a later batch is an INSERT and a
-- SELECT, not a new piece of matching logic to get subtly different.
--
-- Names are Vietnamese, which is why this is a migration file and not a
-- scripts/supabase-sql.sh call. That path mangles non-ASCII - verified on this
-- project: a query containing 'Đặng Đình Thịnh' arrives as '?ng ��nh Th?nh',
-- and 'location LIKE ''%Quận%''' matches 0 rows where '%Qu_n%' matches 421.
-- Migrations applied by CI preserve UTF-8 correctly.

CREATE TABLE IF NOT EXISTS public.realtor_contact_imports (
  -- The visible digits of the masked number the crawler stored, e.g. '0775924'
  -- from '0775 924 ***'. This is the join key back to the listings.
  masked_prefix text PRIMARY KEY,
  phone_e164    text NOT NULL,
  display_name  text,
  sheet_row     text,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT realtor_contact_imports_e164 CHECK (phone_e164 ~ '^\+84[0-9]{9}$'),
  -- A number that does not start with its own mask cannot belong to those
  -- listings. One sheet row had a colleague's number against a different mask;
  -- applying it would have pointed an operator at the wrong broker.
  CONSTRAINT realtor_contact_imports_prefix_agrees
    CHECK ('0' || substring(phone_e164 from 4) LIKE masked_prefix || '%')
);

ALTER TABLE public.realtor_contact_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read realtor_contact_imports" ON public.realtor_contact_imports;
CREATE POLICY "Admins read realtor_contact_imports" ON public.realtor_contact_imports
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Idempotent by construction: re-running changes nothing that is already right.
CREATE OR REPLACE FUNCTION public.apply_realtor_contacts()
RETURNS TABLE (realtors_upserted integer, listings_linked integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  n_realtors integer;
  n_listings integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.realtors (phone_e164, display_name)
    SELECT DISTINCT ON (phone_e164) phone_e164, display_name
    FROM public.realtor_contact_imports
    ORDER BY phone_e164, (display_name IS NULL), imported_at DESC
    ON CONFLICT (phone_e164) DO UPDATE
      -- Never overwrite a name we have with a blank one.
      SET display_name = COALESCE(EXCLUDED.display_name, realtors.display_name),
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO n_realtors FROM ins;

  WITH upd AS (
    UPDATE public.external_properties ep
    SET realtor_id = r.id,
        -- The mask carried no information; the verified number does. Storing it
        -- also makes contact_phone_e164 correct, which is what stops
        -- extract-phone burning reveals on a listing we have already resolved.
        contact_phone = '0' || substring(i.phone_e164 from 4),
        updated_at = now()
    FROM public.realtor_contact_imports i
    JOIN public.realtors r ON r.phone_e164 = i.phone_e164
    WHERE ep.contact_phone LIKE '%*%'
      AND regexp_replace(ep.contact_phone, '[^0-9]', '', 'g') LIKE i.masked_prefix || '%'
    RETURNING 1
  )
  SELECT count(*)::integer INTO n_listings FROM upd;

  RETURN QUERY SELECT n_realtors, n_listings;
END;
$fn$;

INSERT INTO public.realtor_contact_imports (masked_prefix, phone_e164, display_name, sheet_row)
VALUES
  ('0775924', '+84775924600', 'Harry', 'R003'),
  ('0909638', '+84909638631', 'Thành Phạm Vincentral', 'R005'),
  ('0933886', '+84933886666', 'Nguyễn Đức Duy', 'R006'),
  ('0796729', '+84796729999', 'Mr. Trà', 'R007'),
  ('0903738', '+84903738577', 'Xuân Hy', 'R008'),
  ('0938999', '+84938999057', 'Hà Pihomes', 'R009'),
  ('0797799', '+84797799666', 'Hữu Quyền', 'R010'),
  ('0923311', '+84923311444', 'Nguyễn Quốc Toàn', 'R011'),
  ('0931785', '+84931785522', 'Thienhomes', 'R012'),
  ('094286', '+84942861265', 'Tuấn có phòng xịn', 'R013'),
  ('0966768', '+84966768630', 'Văn Toàn', 'R014'),
  ('0775219', '+84775219879', 'Linh', 'R016'),
  ('0907478', '+84907478048', 'Phương', 'R017'),
  ('090747', '+84907478048', 'Phương', 'R017'),
  ('0902929', '+84902929568', 'Z Homes', 'R018'),
  ('0777673', '+84777673976', 'An', 'R019'),
  ('093861', '+84938616353', 'Huyền Nguyễn', 'R023'),
  ('0936032', '+84936032326', 'Ms Mai', 'R025'),
  ('070399', '+84703992779', NULL, 'R027'),
  ('0708864', '+84708864813', 'Cao Trung Nghĩa', 'R031'),
  ('0909931', '+84909931237', 'Cẩm Tú - Cata', 'R034'),
  ('0906322', '+84906322053', 'Em Linh', 'R039'),
  ('0961909', '+84961909202', 'Em Sáng', 'R040'),
  ('0907110', '+84907110827', 'Hoàng Chiến', 'R044'),
  ('097679', '+84976796054', 'Hoàng Tuấn', 'R045')
ON CONFLICT (masked_prefix) DO UPDATE
  SET phone_e164 = EXCLUDED.phone_e164,
      display_name = COALESCE(EXCLUDED.display_name, realtor_contact_imports.display_name),
      sheet_row = EXCLUDED.sheet_row,
      imported_at = now();

SELECT * FROM public.apply_realtor_contacts();
