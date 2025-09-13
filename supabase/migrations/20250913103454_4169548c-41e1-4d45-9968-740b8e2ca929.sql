-- Create table for AI search metadata
CREATE TABLE public.ai_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  query text NOT NULL,
  summary text,
  total_matches integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create table for individual search results/property matches
CREATE TABLE public.ai_search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES public.ai_searches(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  match_score numeric,
  match_reason text,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_search_results ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_searches
CREATE POLICY "Users can view their own AI searches"
ON public.ai_searches
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own AI searches"
ON public.ai_searches
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own AI searches"
ON public.ai_searches
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own AI searches"
ON public.ai_searches
FOR DELETE
USING (auth.uid() = user_id);

-- RLS policies for ai_search_results
CREATE POLICY "Users can view their own AI search results"
ON public.ai_search_results
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));

CREATE POLICY "Users can create AI search results for their searches"
ON public.ai_search_results
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));

CREATE POLICY "Users can update AI search results for their searches"
ON public.ai_search_results
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));

CREATE POLICY "Users can delete AI search results for their searches"
ON public.ai_search_results
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));

-- Add trigger for updated_at
CREATE TRIGGER update_ai_searches_updated_at
  BEFORE UPDATE ON public.ai_searches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add foreign key constraint to conversation
ALTER TABLE public.ai_searches
ADD CONSTRAINT fk_ai_searches_conversation
FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;