-- Create external_properties table for cached marketplace listings
CREATE TABLE public.external_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- External source info
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  
  -- Property data (English translated)
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  location_normalized TEXT,
  city TEXT,
  price NUMERIC,
  price_display TEXT,
  size TEXT,
  description TEXT,
  highlights TEXT[] DEFAULT '{}',
  amenities TEXT[] DEFAULT '{}',
  images TEXT[] DEFAULT '{}',
  
  -- Contact info
  contact_name TEXT,
  contact_phone TEXT,
  
  -- Vibe analysis (matching internal properties)
  vibe TEXT,
  vibe_analysis JSONB DEFAULT '{}',
  
  -- Freshness tracking
  crawled_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
  last_verified_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicates
  UNIQUE(source, external_id)
);

-- Indexes for fast queries
CREATE INDEX idx_external_properties_location ON public.external_properties(location_normalized, city);
CREATE INDEX idx_external_properties_price ON public.external_properties(price);
CREATE INDEX idx_external_properties_source ON public.external_properties(source);
CREATE INDEX idx_external_properties_expires ON public.external_properties(expires_at) WHERE is_active = true;
CREATE INDEX idx_external_properties_crawled ON public.external_properties(crawled_at);
CREATE INDEX idx_external_properties_active ON public.external_properties(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.external_properties ENABLE ROW LEVEL SECURITY;

-- Anyone can view active external properties
CREATE POLICY "Anyone can view active external properties" ON public.external_properties
  FOR SELECT USING (is_active = true AND expires_at > NOW());

-- Create trigger for updated_at
CREATE TRIGGER update_external_properties_updated_at
  BEFORE UPDATE ON public.external_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to normalize location strings for indexing
CREATE OR REPLACE FUNCTION public.normalize_location(location_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(location_text, '[^a-zA-Z0-9\s]', '', 'g'),
        '\s+', ' ', 'g'
      ),
      '^\s+|\s+$', '', 'g'
    )
  );
$$;

-- Function to detect city from location string
CREATE OR REPLACE FUNCTION public.detect_city(location_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN LOWER(location_text) ~ '(ho chi minh|hcm|saigon|sài gòn|quan [0-9]|district [0-9]|d[0-9]|binh thanh|phu nhuan|tan binh|go vap|thu duc)' THEN 'ho_chi_minh'
    WHEN LOWER(location_text) ~ '(ha noi|hanoi|hà nội|ba dinh|hoan kiem|dong da|cau giay|hai ba trung)' THEN 'hanoi'
    WHEN LOWER(location_text) ~ '(da nang|đà nẵng)' THEN 'da_nang'
    ELSE 'other'
  END;
$$;

-- Function to cleanup expired external properties
CREATE OR REPLACE FUNCTION public.cleanup_expired_external_properties()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.external_properties 
  SET is_active = false, updated_at = NOW()
  WHERE expires_at < NOW() AND is_active = true;
END;
$$;