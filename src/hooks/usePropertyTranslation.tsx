import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Apartment } from '@/types';

interface TranslatedFields {
  title: string;
  description: string;
  highlights: string[];
  vibe: string;
  location: string;
}

export const usePropertyTranslation = (apartment: Apartment | null) => {
  const { language } = useLanguage();
  const [translated, setTranslated] = useState<TranslatedFields | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const fetchOrTranslate = useCallback(async () => {
    if (!apartment) return;

    // Detect source language heuristically (Vietnamese chars)
    const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
      apartment.title + (apartment.description || '')
    );
    const sourceLanguage = hasVietnamese ? 'vi' : 'en';

    // If content language matches user language, no translation needed
    if (sourceLanguage === language) {
      setTranslated(null);
      return;
    }

    // Check cache first
    const { data: cached } = await supabase
      .from('property_translations')
      .select('*')
      .eq('property_id', apartment.id)
      .eq('target_language', language)
      .maybeSingle();

    if (cached?.title_translated) {
      setTranslated({
        title: cached.title_translated,
        description: cached.description_translated || apartment.description || '',
        highlights: cached.highlights_translated || apartment.highlights || [],
        vibe: cached.vibe_translated || apartment.vibe || '',
        location: cached.location_translated || apartment.location,
      });
      return;
    }

    // Call edge function to translate
    setIsTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('translate-property', {
        body: {
          propertyId: apartment.id,
          targetLanguage: language,
          title: apartment.title,
          description: apartment.description || '',
          highlights: apartment.highlights || [],
          vibe: apartment.vibe || '',
          location: apartment.location,
        },
      });

      if (!error && data) {
        setTranslated({
          title: data.title || apartment.title,
          description: data.description || apartment.description || '',
          highlights: data.highlights || apartment.highlights || [],
          vibe: data.vibe || apartment.vibe || '',
          location: data.location || apartment.location,
        });
      }
    } catch (err) {
      console.error('[Translation] Failed:', err);
    } finally {
      setIsTranslating(false);
    }
  }, [apartment?.id, language]);

  useEffect(() => {
    fetchOrTranslate();
  }, [fetchOrTranslate]);

  // Return translated fields or originals
  const getTitle = () => translated?.title || apartment?.title || '';
  const getDescription = () => translated?.description || apartment?.description || '';
  const getHighlights = () => translated?.highlights || apartment?.highlights || [];
  const getVibe = () => translated?.vibe || apartment?.vibe || '';
  const getLocation = () => translated?.location || apartment?.location || '';

  return {
    getTitle,
    getDescription,
    getHighlights,
    getVibe,
    getLocation,
    isTranslating,
    hasTranslation: !!translated,
  };
};
