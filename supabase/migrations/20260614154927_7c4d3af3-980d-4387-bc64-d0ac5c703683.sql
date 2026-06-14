
-- Add 'realtor' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'realtor';

-- Create realtor_applications table
CREATE TABLE public.realtor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  company text,
  phone text NOT NULL,
  email text NOT NULL,
  role_type text NOT NULL CHECK (role_type IN ('agent','owner','agency')),
  city text NOT NULL,
  districts text[] NOT NULL DEFAULT '{}',
  years_experience integer NOT NULL DEFAULT 0,
  properties_count integer NOT NULL DEFAULT 0,
  website_or_listing_url text,
  bio text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.realtor_applications TO authenticated;
GRANT ALL ON public.realtor_applications TO service_role;

ALTER TABLE public.realtor_applications ENABLE ROW LEVEL SECURITY;

-- Users can view their own application
CREATE POLICY "Users view own application"
  ON public.realtor_applications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Users can insert their own application
CREATE POLICY "Users insert own application"
  ON public.realtor_applications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own application only while pending; admins can update any
CREATE POLICY "Users update own pending or admin"
  ON public.realtor_applications FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = user_id AND status = 'pending')
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    (auth.uid() = user_id AND status = 'pending')
    OR public.has_role(auth.uid(), 'admin')
  );

-- updated_at trigger
CREATE TRIGGER trg_realtor_applications_updated_at
  BEFORE UPDATE ON public.realtor_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
