-- Create a table for direct messages between matched users
CREATE TABLE public.direct_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID REFERENCES public.property_matches(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at TIMESTAMP WITH TIME ZONE,
  deleted_by UUID[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'
);

-- Create a table to track conversation status for matches
CREATE TABLE public.match_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID REFERENCES public.property_matches(id) ON DELETE CASCADE NOT NULL UNIQUE,
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_message_preview TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_conversations ENABLE ROW LEVEL SECURITY;

-- Create policies for direct_messages
CREATE POLICY "Users can view messages from their matches" 
  ON public.direct_messages 
  FOR SELECT 
  USING (
    auth.uid() = sender_id OR auth.uid() = receiver_id
  );

CREATE POLICY "Users can send messages to their matches" 
  ON public.direct_messages 
  FOR INSERT 
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.property_matches 
      WHERE id = match_id AND (renter_id = auth.uid() OR realtor_id = auth.uid())
    )
  );

CREATE POLICY "Users can update their own messages" 
  ON public.direct_messages 
  FOR UPDATE 
  USING (auth.uid() = sender_id);

-- Create policies for match_conversations  
CREATE POLICY "Users can view conversations from their matches" 
  ON public.match_conversations 
  FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.property_matches 
      WHERE id = match_conversations.match_id 
      AND (renter_id = auth.uid() OR realtor_id = auth.uid())
    )
  );

CREATE POLICY "Users can create conversations for their matches" 
  ON public.match_conversations 
  FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.property_matches 
      WHERE id = match_conversations.match_id 
      AND (renter_id = auth.uid() OR realtor_id = auth.uid())
    )
  );

CREATE POLICY "Users can update conversations for their matches" 
  ON public.match_conversations 
  FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.property_matches 
      WHERE id = match_conversations.match_id 
      AND (renter_id = auth.uid() OR realtor_id = auth.uid())
    )
  );

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_match_conversations_updated_at 
  BEFORE UPDATE ON public.match_conversations 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to automatically update conversation metadata when new message is sent
CREATE OR REPLACE FUNCTION update_conversation_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.match_conversations (match_id, last_message_at, last_message_preview)
  VALUES (NEW.match_id, NEW.created_at, LEFT(NEW.content, 100))
  ON CONFLICT (match_id) 
  DO UPDATE SET 
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.content, 100),
    updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update conversation when new message is sent
CREATE TRIGGER update_conversation_on_new_message
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_on_new_message();