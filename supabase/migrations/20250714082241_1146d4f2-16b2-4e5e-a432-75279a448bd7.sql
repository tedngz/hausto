-- Create a table for matches between renters and properties
CREATE TABLE public.property_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  renter_id UUID NOT NULL,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  realtor_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(renter_id, property_id)
);

-- Enable RLS
ALTER TABLE public.property_matches ENABLE ROW LEVEL SECURITY;

-- Create policies for property matches
CREATE POLICY "Renters can create matches for themselves" 
ON public.property_matches 
FOR INSERT 
WITH CHECK (auth.uid() = renter_id);

CREATE POLICY "Renters can view their own matches" 
ON public.property_matches 
FOR SELECT 
USING (auth.uid() = renter_id);

CREATE POLICY "Realtors can view matches for their properties" 
ON public.property_matches 
FOR SELECT 
USING (auth.uid() = realtor_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_property_matches_updated_at
BEFORE UPDATE ON public.property_matches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();