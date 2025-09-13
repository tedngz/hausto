-- Fix anonymous access policies for ai_searches
DROP POLICY "Users can view their own AI searches" ON public.ai_searches;
DROP POLICY "Users can create their own AI searches" ON public.ai_searches;
DROP POLICY "Users can update their own AI searches" ON public.ai_searches;
DROP POLICY "Users can delete their own AI searches" ON public.ai_searches;

CREATE POLICY "Users can view their own AI searches"
ON public.ai_searches
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own AI searches"
ON public.ai_searches
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own AI searches"
ON public.ai_searches
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own AI searches"
ON public.ai_searches
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Fix anonymous access policies for ai_search_results
DROP POLICY "Users can view their own AI search results" ON public.ai_search_results;
DROP POLICY "Users can create AI search results for their searches" ON public.ai_search_results;
DROP POLICY "Users can update AI search results for their searches" ON public.ai_search_results;
DROP POLICY "Users can delete AI search results for their searches" ON public.ai_search_results;

CREATE POLICY "Users can view their own AI search results"
ON public.ai_search_results
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));

CREATE POLICY "Users can create AI search results for their searches"
ON public.ai_search_results
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));

CREATE POLICY "Users can update AI search results for their searches"
ON public.ai_search_results
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));

CREATE POLICY "Users can delete AI search results for their searches"
ON public.ai_search_results
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.ai_searches
  WHERE ai_searches.id = ai_search_results.search_id
  AND ai_searches.user_id = auth.uid()
));