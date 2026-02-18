
-- Create a table to cache AI translations of property listings
CREATE TABLE public.property_translations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL,
  property_type text NOT NULL DEFAULT 'internal', -- 'internal' or 'external'
  target_language text NOT NULL DEFAULT 'vi', -- ISO code: 'vi' or 'en'
  title_translated text,
  description_translated text,
  highlights_translated text[],
  vibe_translated text,
  location_translated text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(property_id, property_type, target_language)
);

-- Enable RLS
ALTER TABLE public.property_translations ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read translations
CREATE POLICY "Authenticated users can view translations"
ON public.property_translations
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Service role inserts translations (via edge function)
CREATE POLICY "Service role can insert translations"
ON public.property_translations
FOR INSERT
WITH CHECK (true);

-- Service role can update translations
CREATE POLICY "Service role can update translations"
ON public.property_translations
FOR UPDATE
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_property_translations_updated_at
BEFORE UPDATE ON public.property_translations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
