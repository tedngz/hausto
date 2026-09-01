-- Allow renters to delete their own property matches
CREATE POLICY "Renters can delete their own matches" 
ON public.property_matches 
FOR DELETE 
USING (auth.uid() = renter_id);