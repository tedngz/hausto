-- Create user_preferences table to store renter preferences
CREATE TABLE public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  styles TEXT[] DEFAULT '{}',
  colors TEXT[] DEFAULT '{}',
  activities TEXT[] DEFAULT '{}',
  price_range_min NUMERIC DEFAULT 0,
  price_range_max NUMERIC DEFAULT 50000000,
  size TEXT DEFAULT '',
  location TEXT[] DEFAULT '{}',
  move_in_date TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "Users can view their own preferences"
ON public.user_preferences
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own preferences
CREATE POLICY "Users can insert their own preferences"
ON public.user_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update their own preferences"
ON public.user_preferences
FOR UPDATE
USING (auth.uid() = user_id);

-- Create function for realtors to view matched renter preferences
CREATE OR REPLACE FUNCTION public.get_renter_preferences_for_realtor(renter_id UUID)
RETURNS TABLE (
  styles TEXT[],
  colors TEXT[],
  activities TEXT[],
  price_range_min NUMERIC,
  price_range_max NUMERIC,
  size TEXT,
  location TEXT[],
  move_in_date TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Only return preferences if the requesting realtor has a match with this renter
  SELECT 
    up.styles,
    up.colors,
    up.activities,
    up.price_range_min,
    up.price_range_max,
    up.size,
    up.location,
    up.move_in_date
  FROM public.user_preferences up
  WHERE up.user_id = renter_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.property_matches m
      WHERE m.renter_id = renter_id 
        AND m.realtor_id = auth.uid()
    );
$$;

-- Trigger for updated_at
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();