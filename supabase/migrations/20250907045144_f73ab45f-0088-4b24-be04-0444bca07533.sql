-- Create support conversations table
CREATE TABLE public.support_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create support messages table
CREATE TABLE public.support_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL,
  content TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Create policies for support conversations
CREATE POLICY "Users can view their own support conversations" 
ON public.support_conversations 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own support conversations" 
ON public.support_conversations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own support conversations" 
ON public.support_conversations 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own support conversations" 
ON public.support_conversations 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create policies for support messages
CREATE POLICY "Users can view their own support messages" 
ON public.support_messages 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.support_conversations 
  WHERE support_conversations.id = support_messages.conversation_id 
  AND support_conversations.user_id = auth.uid()
));

CREATE POLICY "Users can create their own support messages" 
ON public.support_messages 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.support_conversations 
  WHERE support_conversations.id = support_messages.conversation_id 
  AND support_conversations.user_id = auth.uid()
));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_support_conversations_updated_at
BEFORE UPDATE ON public.support_conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();