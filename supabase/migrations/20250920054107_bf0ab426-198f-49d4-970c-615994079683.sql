-- Add ai_requests column to daily_usage table
ALTER TABLE daily_usage ADD COLUMN ai_requests INTEGER DEFAULT 0;

-- Create table to track declined properties per user
CREATE TABLE declined_properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  property_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, property_id)
);

-- Enable RLS on declined_properties
ALTER TABLE declined_properties ENABLE ROW LEVEL SECURITY;

-- Create policies for declined_properties
CREATE POLICY "Users can manage their own declined properties"
ON declined_properties
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add index for better performance
CREATE INDEX idx_declined_properties_user_id ON declined_properties(user_id);
CREATE INDEX idx_declined_properties_property_id ON declined_properties(property_id);